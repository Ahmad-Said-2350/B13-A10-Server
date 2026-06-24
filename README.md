
---

# SERVER README — `server/README.md`

```markdown
# RecipeHub — Server

REST API backend for RecipeHub. Handles recipes, favorites, payments, admin operations, JWT verification, and MongoDB communication.

Built for simplicity — clean routes, verified access, predictable responses.

---

## Overview

The RecipeHub server powers all data operations for the platform. It exposes REST endpoints for recipes, favorites, reports, and payments. Private routes are protected by JWT verification via HTTPOnly cookie. Data is stored in MongoDB Atlas using the native driver.

**Client Repo:** `https://github.com/your-username/recipehub-client`  
**Live Server:** `https://your-server-url.onrender.com`

---

## What's Inside

### Recipes

- Public browse with search, category filter, and pagination
- Featured and popular recipe endpoints for homepage
- Create, update, delete (with premium recipe limit for free users)
- Like/unlike with live `likesCount`

### Favorites

- Add/remove favorites by recipe ID
- Returns full recipe objects (not favorite document IDs)
- Ordered by most recently favorited

### Payments (Stripe)

- Premium subscription checkout session
- Single recipe purchase checkout
- Payment success recorded via client callback
- Purchased recipes list for logged-in user

### Reports & Admin

- Users can report recipes
- Admin: stats, user management (block), recipe management (feature/delete)
- Admin: resolve or dismiss reports

### JWT Auth

- `POST /auth/jwt` — issue HTTPOnly cookie after BetterAuth login
- `verifyToken` middleware on all private routes
- Blocks direct browser navigation to protected API URLs
- Requires `X-Requested-With: XMLHttpRequest` header from client

---

## API Routes

### Public

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check |
| GET | `/auth/status` | Server status + JWT hint |
| GET | `/recipes` | Paginated recipe list |
| GET | `/recipes/featured` | Featured recipes (max 6) |
| GET | `/recipes/popular` | Popular by likes (max 6) |
| GET | `/recipes/:id` | Single recipe details |

### Private (JWT required)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/auth/jwt` | Issue JWT cookie |
| DELETE | `/auth/logout` | Clear JWT cookie |
| GET | `/recipes/my-recipes` | Current user's recipes |
| POST | `/recipes` | Create recipe |
| PUT | `/recipes/:id` | Update recipe |
| DELETE | `/recipes/:id` | Delete recipe |
| POST | `/recipes/:id/like` | Toggle like |
| GET | `/favorites` | User's favorite recipes |
| POST | `/favorites` | Toggle favorite |
| DELETE | `/favorites/:recipeId` | Remove favorite |
| POST | `/reports` | Submit report |
| POST | `/create-checkout-session` | Premium Stripe checkout |
| POST | `/create-recipe-checkout-session` | Recipe purchase checkout |
| PATCH | `/user/premium` | Activate premium after payment |
| PATCH | `/user/purchase-recipe` | Record recipe purchase |
| GET | `/payments/purchased-recipes` | Purchased recipe list |
| GET | `/payments` | User payment history |

### Admin (JWT + admin role)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/stats` | Dashboard statistics |
| GET | `/admin/users` | All users |
| PATCH | `/admin/users/:id/block` | Block/unblock user |
| GET | `/admin/recipes` | All recipes (paginated) |
| PUT | `/admin/recipes/:id` | Edit any recipe |
| DELETE | `/admin/recipes/:id` | Delete recipe |
| PATCH | `/admin/recipes/:id/feature` | Toggle featured |
| GET | `/admin/reports` | Pending reports |
| DELETE | `/admin/reports/:id` | Dismiss report |
| DELETE | `/admin/reports/:id/recipe` | Delete reported recipe |
| GET | `/admin/transactions` | All transactions |

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Node.js | Runtime |
| Express.js | Web framework |
| MongoDB Atlas | Cloud database (native driver) |
| jsonwebtoken | JWT sign/verify |
| Stripe | Premium + recipe payments |
| dotenv | Environment variables |
| cors | Cross-origin with credentials |

---

## Getting Started

### Install

```bash
git clone https://github.com/your-username/recipehub-server
cd recipehub-server
npm install
npm run dev