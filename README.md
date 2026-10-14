# Smart Checkout

Scan-and-go shopping. Customers log in, pick a shop, scan barcodes to build a live e-bill (change quantity, delete items),
tap **End shopping & pay**, pay in a gateway page, and get a unique bill ID. The shop's staff receive the same e-bill
instantly on a live dashboard and can mark it reviewed.

The app also has a **profile page** (details, spend stats, coupons, light/dark theme), and a built-in **assistant**
that answers where an item is in the shop ("where is UNO?" → Aisle 3, Shelf 2), what it costs, and how the app works.

```
backend/   Node + Express + SQLite API, mock payment gateway, staff dashboard (web)
mobile/    React Native (Expo) customer app
```

## 1. Prerequisites
- **Node.js 22.13 or newer** (LTS from https://nodejs.org). The backend uses Node's built-in SQLite, so nothing needs compiling.
- **Expo Go** on your phone (Android/iOS). The phone and computer must be on the **same Wi-Fi**.

## 2. Run the backend
```bash
cd backend
npm install
npm test        # optional: end-to-end check of the full flow
npm start
```
It seeds three demo shops (and their coupons) on start and prints your computer's LAN address. Seeding is idempotent:
it adds whatever is missing without wiping existing accounts, carts or bills, so pulling new demo data never needs a reset.

- Staff dashboard: http://localhost:4000/staff — password `staff123` for `staff@freshmart.com`,
  `staff@citysuper.com` or `staff@meeshgames.com` (each one only sees its own shop's bills)
- Demo barcodes to scan from a screen: http://localhost:4000/barcodes (grouped per shop, with each item's aisle/shelf)
- Windows: allow Node through the firewall on private networks when prompted, or the phone can't connect.

## 3. Run the customer app
```bash
cd mobile
npm install
npx expo install --fix     # aligns package versions with your Expo Go version
npx expo start
```
Scan the QR code with Expo Go. The app finds the backend automatically (same computer, port 4000).
If it can't, set it explicitly: `set EXPO_PUBLIC_API_URL=http://<your-pc-ip>:4000` (PowerShell: `$env:EXPO_PUBLIC_API_URL="http://<ip>:4000"`) before `npx expo start`.

### The three demo shops
| Shop | Sells | Staff login |
|---|---|---|
| 🛒 Fresh Mart | Groceries and household essentials (14 items) | `staff@freshmart.com` |
| 🏪 City Super Store | General store, same staples at different prices (13 items) | `staff@citysuper.com` |
| 🎮 Meesh Games | Video games, board games, toys and collectibles (21 items) | `staff@meeshgames.com` |

## 4. Try the whole flow
1. Open the staff dashboard in a browser and log in.
2. In the app: create an account, choose **Fresh Mart** (or **Meesh Games** for games and toys).
3. Scan barcodes from the `/barcodes` page (or type a number in the box under the camera).
   Use **+ / -** to change quantities and the bin icon to delete; the total updates instantly.
4. Tap **End shopping & pay**. In the gateway page use test card `4242 4242 4242 4242` (any expiry/CVC).
   `4000 0000 0000 0002` simulates a declined card.
5. The app shows the success screen with your **bill ID** (a short number like `4827`) and the bill appears on the staff dashboard
   immediately (with a beep). Staff can add a note and click **Mark as reviewed**; the customer sees the review status in *My past bills*.

## How it works
| Piece | Details |
|---|---|
| Auth | Email + password, bcrypt hashes, JWT (7 days). Staff accounts are tied to one shop and only see that shop's bills. |
| Cart | Stored on the server per customer and shop, so closing the app doesn't lose the bill (*Resume shopping*). Prices always come from the server. |
| Payment | `POST /api/payments` freezes the cart and returns a gateway URL opened in a WebView. On success the server creates the bill with a unique ID in one transaction. |
| Staff push | Server-Sent Events (`/api/staff/stream`) push each paid bill to the right shop's dashboard. |
| Profile | `GET /api/profile` returns details, spend stats (bills, total, items scanned, most-visited shop) and coupons. |
| Coupons | Seeded per shop or global; every customer is granted the welcome set. Shown in the profile with code, terms and expiry. |
| Assistant | `POST /api/assistant` — rule-based, so it needs no API key and works offline. Product questions are answered from the shop's real catalogue, so an aisle is never invented. |
| Item locations | Each product row carries `aisle`, `shelf` and `section`, which is what lets the assistant answer "where is X?". |
| Theming | Light/dark/system, chosen in the profile and remembered on the device. One palette per mode in `mobile/src/theme.js`. |

## UPI payments
At checkout the customer chooses **UPI app** or **Card**. UPI opens a `upi://pay` link (GPay/PhonePe/Paytm) with the shop's
UPI ID, the exact bill amount and a note containing the bill ID (e.g. "Fresh Mart bill 4036"). A UPI app can't report the
result back, so the customer taps **I have paid** and the bill is saved as UPI; the staff dashboard flags it so staff can
match the amount and note in their UPI/bank app.
Set the shop's real UPI ID before starting the backend (otherwise a demo ID is used and real payments will fail):
```powershell
$env:UPI_ID="yourshop@okhdfcbank"; npm start
```
For automatic verification, use a gateway such as Razorpay (UPI + cards + netbanking, webhook-confirmed).

## Going to real Stripe later
The mock gateway lives in `backend/src/payments.js`. Replace `POST /api/payments` with a Stripe Checkout Session
(return its URL as `payUrl`) and move the "create bill" transaction into the `checkout.session.completed` webhook handler.
The app and staff dashboard need no changes.

## Production notes
Set `JWT_SECRET`, serve over HTTPS, and replace the demo catalogue/staff in `backend/src/seed.js` with your own data
(`npm run reset-db` wipes the database so it re-seeds).
