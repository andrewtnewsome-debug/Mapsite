# Certified Exchange (clickable prototype)

A deal marketplace for NMSDC-certified minority business enterprises and the investors and buyers who want to back or acquire them. Owners list anonymously, investors browse teasers, and confidential materials (company name, city, CIM, messaging) are released only after the platform's standard NDA is signed.

This is a demo-quality prototype: no backend, no real authentication, no document storage. All data is fictional.

## Run it

Requires Node.js 20 or newer.

```bash
cd certified-exchange
npm install
npm run dev        # http://localhost:3100
```

`npm run build && npm start` runs the production build on the same port.

## The demo story (about three minutes)

1. On the landing page, choose **Browse deals as an investor** (you are Raymond Chu, Northgate Equity Partners).
2. In the **Deal Feed**, filter by industry, region/state, revenue, EBITDA, deal type, certification or years in business; search by keyword; sort by newest, revenue or EBITDA. Toggle **Match my criteria** or switch to table view.
3. Open a deal. The teaser hides the company name and city, and the CIM is locked.
4. Click **Pursue This Deal**, type your name in the NDA, tick the consent box, and sign.
5. The company name and city appear, **View CIM** opens a full memorandum (overview, FY2023–FY2025 financials, customers, operations, management, transaction), and the inquiry form opens.
6. Send an inquiry with a message and the three standard answers (criteria fit, capital available, timeline).
7. Switch the header to **Business Owner**. You are signed in as the owner of the deal you just pursued. Open **Investor Pursuits** or **Messages** to see the inquiry and the investor's profile, then reply.
8. Switch back to **Investor** and open **Messages** to see the reply.

The **Demo guide** button in the header repeats these steps. **Reset demo data** in the sidebar restores the seed state.

## Roles

| Role | Pages |
| --- | --- |
| Investor | Deal Feed, deal detail, CIM, Saved (watchlist + saved searches), Pursuits & NDAs, Messages, Firm Profile (editable criteria) |
| Business Owner | Overview, Listing Builder (teaser preview + anonymity check), Investor Pursuits (NDA signers only), Messages, certification panel |
| Admin (NMSDC staff) | Overview (stats, deal engagement, activity), Listing Review (approve / request changes), Certifications (verify, renewal reminders), Investor Verification |

Use the persona menu (top right) to act as any of the 5 investors or 15 owners. Try **Celeste Broussard** (draft listing → submit for review) and then approve it as Admin.

## Where things live

| Path | Contents |
| --- | --- |
| `config/brand.ts` | Product name, monogram, sponsor name, accent color, NDA version, storage key. Rename or recolor here. |
| `data/` | Types and mock data: 15 businesses and deals, 5 investor profiles, users, seeded NDAs/inquiries/messages, NDA text, taxonomy |
| `lib/store.tsx` | App state (NDAs, inquiries, messages, saved deals and searches, listing edits, admin actions) persisted to `localStorage` |
| `lib/deals.ts` | Filtering, sorting, criteria matching, certification health |
| `components/ui/` | shadcn-style primitives (button, badge, card, inputs, dialog, toast) |
| `app/(platform)/` | All signed-in screens under a shared sidebar + header shell |

## Mocked or out of scope

Each is marked with a `TODO(...)` comment in the code.

- **Auth:** the role switcher stands in for sign-in (`TODO(auth)`).
- **E-signature:** typed name plus consent checkbox with a timestamp; not ESIGN/UETA compliant (`TODO(e-sign)`). NDA text is unreviewed placeholder language (`TODO(legal)`).
- **Documents:** the CIM is rendered from mock data; PDF download, data room and certificate uploads are mocked (`TODO(documents)`, `TODO(data-room)`, `TODO(uploads)`).
- **Email:** no notifications or renewal reminders are sent (`TODO(notifications)`, `TODO(email)`).
- **NMSDC data:** council names and certificate numbers are illustrative; "Verify with council" is a manual click (`TODO(nmsdc-data)`, `TODO(nmsdc-api)`).
- **Persistence:** state lives in this browser's `localStorage`. Two tabs stay in sync (each keeps its own role), but nothing is shared across devices.
