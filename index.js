const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ObjectId } = require("mongodb");
const Stripe = require("stripe");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const isProduction = process.env.NODE_ENV === "production";

app.use(
  cors({
    origin: [process.env.CLIENT_URL, "http://localhost:3000"].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const setTokenCookie = (res, token) => {
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
};

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function run() {
  await client.connect();
  const db = client.db("recipeHub");
  const usersCollection = db.collection("user");
  const recipesCollection = db.collection("recipes");
  const favoritesCollection = db.collection("favorites");
  const reportsCollection = db.collection("reports");
  const paymentsCollection = db.collection("payments");

  const serializeRecipe = (recipe) => ({
    ...recipe,
    _id: recipe._id.toString(),
    recipeId: recipe._id.toString(),
  });

  const parseRecipeObjectId = (id) => {
    const value = String(id || "").trim();
    if (!ObjectId.isValid(value)) {
      return null;
    }
    return new ObjectId(value);
  };


  const verifyToken = (req, res, next) => {
    const isBrowserNavigation =
      req.get("sec-fetch-mode") === "navigate" ||
      req.get("sec-fetch-dest") === "document" ||
      (req.get("accept") || "").includes("text/html");

    if (isBrowserNavigation || req.get("x-requested-with") !== "XMLHttpRequest") {
      return res.status(401).json({ message: "Unauthorized" });
    }

    (async () => {
      try {
        const token = req.cookies?.token;
        if (!token) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        let payload;
        try {
          payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch {
          return res.status(403).json({ message: "Forbidden" });
        }

        if (!payload?.email) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email: payload.email });
        if (!user) {
          return res.status(401).json({ message: "User not found" });
        }
        if (user.isBlocked) {
          return res.status(403).json({ message: "Account blocked. Contact admin." });
        }

        req.user = { email: user.email, role: user.role || "user" };
        next();
      } catch (err) {
        next(err);
      }
    })();
  };

  const verifyAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }
    next();
  };

  app.get("/", (req, res) => res.send("RecipeHub server running"));

  // Public — for assignment security testing
  app.get("/auth/status", (req, res) => {
    res.json({
      server: "online",
      version: "secured-v2",
      hasJwtCookie: Boolean(req.cookies?.token),
      hint: "Browser URL on protected routes returns 401. App API calls work with JWT.",
    });
  });


  // ── JWT ──
  app.post("/auth/jwt", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.isBlocked) {
      return res.status(403).json({ message: "Account blocked. Contact admin." });
    }

    const token = jwt.sign(
      { email, role: user.role || "user" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    setTokenCookie(res, token);
    res.json({ success: true, role: user.role || "user" });
  });

  app.delete("/auth/logout", (req, res) => {
    res.clearCookie("token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    });
    res.json({ success: true });
  });


  // ── RECIPES (public) 
  app.get("/recipes", async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 9;
      const skip = (page - 1) * limit;
      const filter = { status: "active" };

      if (req.query.category) {
        const cats = Array.isArray(req.query.category)
          ? req.query.category
          : [req.query.category];
        filter.category = { $in: cats };
      }

      if (req.query.search) {
        const q = req.query.search.trim();
        if (q) {
          filter.$or = [
            { recipeName: { $regex: q, $options: "i" } },
            { cuisineType: { $regex: q, $options: "i" } },
            { category: { $regex: q, $options: "i" } },
            { authorName: { $regex: q, $options: "i" } },
          ];
        }
      }

      const total = await recipesCollection.countDocuments(filter);
      const recipes = await recipesCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      res.json({
        recipes: recipes.map(serializeRecipe),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/recipes/featured", async (req, res) => {
    try {
      const recipes = await recipesCollection
        .find({ isFeatured: true, status: "active" })
        .limit(6)
        .toArray();
      res.json(recipes.map(serializeRecipe));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/recipes/popular", async (req, res) => {
    try {
      const recipes = await recipesCollection
        .find({ status: "active" })
        .sort({ likesCount: -1 })
        .limit(6)
        .toArray();
      res.json(recipes.map(serializeRecipe));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/recipes/my-recipes", verifyToken, async (req, res) => {
    try {
      const recipes = await recipesCollection
        .find({ authorEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(recipes.map(serializeRecipe));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/recipes/:id", async (req, res) => {
    try {
      if (
        ["featured", "popular", "my-recipes"].includes(req.params.id)
      ) {
        return res.status(404).json({ message: "Not found" });
      }

      const objectId = parseRecipeObjectId(req.params.id);
      if (!objectId) {
        return res.status(400).json({ message: "Invalid recipe id" });
      }

      const recipe = await recipesCollection.findOne({ _id: objectId });
      if (!recipe) return res.status(404).json({ message: "Recipe not found" });
      res.json(serializeRecipe(recipe));
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });


  app.post("/recipes", verifyToken, async (req, res) => {
    try {
      const user = await usersCollection.findOne({ email: req.user.email });
      if (!user?.isPremium) {
        const count = await recipesCollection.countDocuments({
          authorEmail: req.user.email,
        });
        if (count >= 2) {
          return res.status(403).json({
            message: "Recipe limit reached. Upgrade to premium.",
            limitReached: true,
          });
        }
      }

      const now = new Date();
      const recipe = {
        ...req.body,
        likesCount: 0,
        likedBy: [],
        isFeatured: false,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      const result = await recipesCollection.insertOne(recipe);
      res.json({ insertedId: result.insertedId });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/recipes/:id", verifyToken, async (req, res) => {
    try {
      const data = { ...req.body, updatedAt: new Date() };
      delete data._id;
      const result = await recipesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: data }
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/recipes/:id", verifyToken, async (req, res) => {
    try {
      const result = await recipesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── LIKE 
  app.post("/recipes/:id/like", verifyToken, async (req, res) => {
    try {
      const recipeId = req.params.id;
      const email = req.user.email;
      const recipe = await recipesCollection.findOne({
        _id: new ObjectId(recipeId),
      });
      if (!recipe) return res.status(404).json({ message: "Recipe not found" });

      const alreadyLiked = recipe.likedBy?.includes(email);
      const update = alreadyLiked
        ? { $pull: { likedBy: email }, $inc: { likesCount: -1 } }
        : { $push: { likedBy: email }, $inc: { likesCount: 1 } };

      await recipesCollection.updateOne({ _id: new ObjectId(recipeId) }, update);
      res.json({ liked: !alreadyLiked });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── FAVORITES 
  app.post("/favorites", verifyToken, async (req, res) => {
    try {
      const { recipeId } = req.body;
      if (!recipeId) {
        return res.status(400).json({ message: "Recipe ID required" });
      }

      const normalizedRecipeId = String(recipeId);
      const user = await usersCollection.findOne({ email: req.user.email });
      const userEmail = req.user.email;
      const existing = await favoritesCollection.findOne({
        userEmail,
        recipeId: normalizedRecipeId,
      });
      if (existing) {
        await favoritesCollection.deleteOne({ userEmail, recipeId: normalizedRecipeId });
        return res.json({ saved: false });
      }
      await favoritesCollection.insertOne({
        userEmail,
        userId: user?.id || user?._id?.toString(),
        recipeId: normalizedRecipeId,
        addedAt: new Date(),
      });
      res.json({ saved: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/favorites", verifyToken, async (req, res) => {
    try {
      const favorites = await favoritesCollection
        .find({ userEmail: req.user.email })
        .sort({ addedAt: -1 })
        .toArray();

      const recipeIds = favorites
        .map((f) => {
          try {
            return new ObjectId(f.recipeId);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      if (recipeIds.length === 0) {
        return res.json([]);
      }

      const recipes = await recipesCollection
        .find({ _id: { $in: recipeIds }, status: "active" })
        .toArray();

      const recipeMap = new Map(recipes.map((r) => [r._id.toString(), r]));
      const ordered = favorites
        .map((f) => {
          const favoriteRecipeId = String(f.recipeId || "").trim();
          const recipe =
            recipeMap.get(favoriteRecipeId) ||
            recipeMap.get(String(f.recipeId));
          return recipe ? serializeRecipe(recipe) : null;
        })
        .filter(Boolean);

      res.json(ordered);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/favorites/:recipeId", verifyToken, async (req, res) => {
    try {
      const result = await favoritesCollection.deleteOne({
        userEmail: req.user.email,
        recipeId: String(req.params.recipeId),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── REPORTS 
  app.post("/reports", verifyToken, async (req, res) => {
    try {
      const report = {
        ...req.body,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await reportsCollection.insertOne(report);
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── PAYMENT 
  app.post("/create-checkout-session", verifyToken, async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email required" });
      if (email !== req.user.email) {
        return res.status(403).json({ message: "Email mismatch" });
      }
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(500).json({ message: "STRIPE_SECRET_KEY not configured" });
      }

      const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;

      const lineItems = priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "usd",
                product_data: { name: "RecipeHub Premium Membership" },
                unit_amount: 1999,
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
          ];

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: email,
        line_items: lineItems,
        metadata: { email, type: "premium" },
        success_url: `${process.env.CLIENT_URL}/payment/success?email=${encodeURIComponent(email)}&type=premium`,
        cancel_url: `${process.env.CLIENT_URL}/dashboard/user`,
      });

      if (!session.url) {
        return res.status(500).json({ message: "Stripe did not return checkout URL" });
      }
      res.json({ url: session.url });
    } catch (err) {
      console.error("Stripe checkout error:", err.message);
      res.status(500).json({ message: err.message || "Payment setup failed" });
    }
  });

  app.patch("/user/premium", verifyToken, async (req, res) => {
    try {
      const { email, transactionId, amount } = req.body;
      if (!email || email !== req.user.email) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      const user = await usersCollection.findOne({ email });
      await usersCollection.updateOne({ email }, { $set: { isPremium: true } });
      await paymentsCollection.insertOne({
        userEmail: email,
        userId: user?.id || user?._id?.toString(),
        amount: amount || 19.99,
        transactionId: transactionId || `TXN_${Date.now()}`,
        paymentStatus: "success",
        paidAt: new Date(),
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/create-recipe-checkout-session", verifyToken, async (req, res) => {
    try {
      const { email, recipeId } = req.body;
      if (!email || email !== req.user.email) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: email,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: "Recipe Purchase" },
              unit_amount: 499,
            },
            quantity: 1,
          },
        ],
        metadata: { email, type: "recipe", recipeId },
        success_url: `${process.env.CLIENT_URL}/payment/success?email=${encodeURIComponent(email)}&type=recipe&recipeId=${recipeId}`,
        cancel_url: `${process.env.CLIENT_URL}/recipes/${recipeId}`,
      });
      res.json({ url: session.url });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/user/purchase-recipe", verifyToken, async (req, res) => {
    try {
      const { email, recipeId, transactionId, amount } = req.body;
      const normalizedRecipeId = String(recipeId || "").trim();

      if (!email || email !== req.user.email) {
        return res.status(403).json({ message: "Unauthorized" });
      }
      if (!normalizedRecipeId || !parseRecipeObjectId(normalizedRecipeId)) {
        return res.status(400).json({ message: "Valid recipe ID required" });
      }

      const user = await usersCollection.findOne({ email });
      const existing = await paymentsCollection.findOne({
        userEmail: email,
        recipeId: normalizedRecipeId,
        paymentStatus: "success",
      });

      if (!existing) {
        await paymentsCollection.insertOne({
          userEmail: email,
          userId: user?.id || user?._id?.toString(),
          recipeId: normalizedRecipeId,
          amount: amount || 4.99,
          transactionId: transactionId || `TXN_${Date.now()}`,
          paymentStatus: "success",
          paidAt: new Date(),
        });
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/payments/purchased-recipes", verifyToken, async (req, res) => {
    try {
      const payments = await paymentsCollection
        .find({
          userEmail: req.user.email,
          recipeId: { $exists: true, $ne: null },
          $or: [
            { paymentStatus: "success" },
            { paymentStatus: { $exists: false } },
          ],
        })
        .sort({ paidAt: -1 })
        .toArray();

      const seen = new Set();
      const orderedIds = [];

      for (const payment of payments) {
        const id = String(payment.recipeId || "").trim();
        if (!id || seen.has(id) || !parseRecipeObjectId(id)) continue;
        seen.add(id);
        orderedIds.push(id);
      }

      if (orderedIds.length === 0) {
        return res.json([]);
      }

      const objectIds = orderedIds.map((id) => new ObjectId(id));
      const recipes = await recipesCollection
        .find({ _id: { $in: objectIds } })
        .toArray();

      const recipeMap = new Map(recipes.map((r) => [r._id.toString(), r]));
      const ordered = orderedIds
        .map((id) => recipeMap.get(id))
        .filter(Boolean)
        .map(serializeRecipe);

      res.json(ordered);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/payments", verifyToken, async (req, res) => {
    try {
      const payments = await paymentsCollection
        .find({ userEmail: req.user.email })
        .sort({ paidAt: -1 })
        .toArray();
      res.json(payments);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── ADMIN ──
  app.get("/admin/stats", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const totalUsers = await usersCollection.countDocuments();
      const totalRecipes = await recipesCollection.countDocuments();
      const totalPremium = await usersCollection.countDocuments({ isPremium: true });
      const totalReports = await reportsCollection.countDocuments({
        status: "pending",
      });
      res.json({ totalUsers, totalRecipes, totalPremium, totalReports });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const users = await usersCollection.find({}).sort({ createdAt: -1 }).toArray();
      res.json(users);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/admin/users/:id/block", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const user = await usersCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.role === "admin") {
        return res.status(400).json({ message: "Cannot block admin users" });
      }
      if (user.email === req.user.email) {
        return res.status(400).json({ message: "Cannot block your own account" });
      }
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { isBlocked: !user.isBlocked } }
      );
      res.json({ ...result, isBlocked: !user.isBlocked });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/admin/recipes", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const total = await recipesCollection.countDocuments();
      const recipes = await recipesCollection
        .find({})
        .skip(skip)
        .limit(limit)
        .toArray();
      res.json({
        recipes: recipes.map(serializeRecipe),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/admin/recipes/:id", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const result = await recipesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/admin/recipes/:id", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const data = { ...req.body, updatedAt: new Date() };
      delete data._id;
      const result = await recipesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: data }
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/admin/recipes/:id/feature", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const recipe = await recipesCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      const result = await recipesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { isFeatured: !recipe?.isFeatured } }
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/admin/reports", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const reports = await reportsCollection
        .find({ status: "pending" })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(reports);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/admin/reports/:id", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const result = await reportsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "dismissed" } }
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/admin/reports/:id/recipe", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const report = await reportsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (report?.recipeId) {
        await recipesCollection.deleteOne({
          _id: new ObjectId(report.recipeId),
        });
      }
      await reportsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status: "resolved" } }
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/admin/transactions", verifyToken, verifyAdmin, async (req, res) => {
    try {
      const payments = await paymentsCollection.find({}).sort({ paidAt: -1 }).toArray();
      res.json(payments);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });

  console.log("Connected to MongoDB — recipeHub");
  console.log("Security v2: browser navigation blocked on protected API routes");

  app.listen(port, () => {
    console.log(`RecipeHub server running on port ${port}`);
  });
}

run().catch(console.dir);
