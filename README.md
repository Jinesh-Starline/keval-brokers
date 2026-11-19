# Keval Brokers

Daily deal register, WhatsApp messages and brokerage bills (Electron, Windows).

## Run

1. Install Node.js (LTS) from nodejs.org
2. In this folder: `npm install`
3. `npm start`

Windows installer: `npm run dist` (output in `dist/`).

## End-of-day flow

1. **Today**: pick the date and add each deal: seller, buyer, commodity, quantity, rate.
   Seller, buyer and commodity stay selected for the next deal.
2. **Quantity** can be Bags, Truck, Small cargo van, Tempo, Tractor. Add more types in Settings.
3. **Two varieties in one truck**: tap the G20 and Jini buttons under Rate and enter a price for each.
   Both prices go into the same deal and the same message.
4. A deal counted in trucks or vans waits under **Awaiting unload**. After unloading, enter the bags
   for each variety (the total fills in) or just the total. The brokerage is the same for all bags.
5. Under the deals, one WhatsApp message is prepared per party, seller and buyer both. Press
   **Send on WhatsApp**, then send it in WhatsApp. After the bags are entered the message changes
   and shows **Send update**.

Every party needs a WhatsApp number in **Parties**.

## Bills

**Bills**: choose a party and period (defaults to the financial year), then **Save as PDF**.
Brokerage per deal = bags x Rs per bag, rounded down to the nearest Rs 5 (set per party).
Deals still awaiting unload are left out and the screen tells you how many.

## Data

Stored in a JSON file in the app's user-data folder, with a daily backup (last 60 kept).
Settings has firm, bank and PAN details for the bill, message language (Gujarati or English),
quantity types, and a button to load the 2024-25 Vrundavan bill as sample data.

## Tests

`npm test` checks the brokerage maths against the real bill (13 deals = Rs 7,495), the two-variety
truck flow, and drives the screens.
