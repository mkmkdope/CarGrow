# CarGrow

**Move Cargo. Grow Trust.**
CarGrow is a role-based Ethereum dApp for milestone logistics escrow. 
A Shipper creates and funds an agreement, a Carrier submits milestone evidence and the Shipper verifies that evidence before the `CarGrow` Solidity contract releases each 30% / 30% / 40% payout.

## How the system works
Register wallet role
        ↓
Shipper creates agreement
        ↓
Carrier accepts agreement
        ↓
Shipper funds exact escrow value
        ↓
Carrier submits milestone evidence
        ↓
Shipper verifies and confirms evidence
        ↓
Smart contract releases milestone payout

If the deadline passes before completion, no more evidence or milestone confirmations are permitted. Previously verified payments remain with the Carrier while every wei still held in escrow is returned to the Shipper during settlement.

### 1. User Registration & Access Control
- A wallet registers once as either Shipper or Carrier.
- One wallet cannot hold both roles.
- The role is permanent for the current deployment.
- MetaMask proves wallet ownership by signing transactions.

Relevant code: `registerUser()`, `onlyRole()`, `users`.

### 2. Agreement Creation & Validation
- Only a registered Shipper can create an agreement.
- Cargo description, positive ETH value, and a future deadline are mandatory.
- Every agreement begins with the `Open` status.
- Milestones are Cargo Pickup 30%, In-Transit/Customs 30% and Final Delivery 40%.
- Only a registered Carrier can accept an Open, unexpired agreement.
- The accepted Carrier address is stored against that agreement.

Relevant code: `createAgreement()`, `acceptAgreement()`, `agreements`, `milestones`.

### 3. Financial Escrow & Funding
- Only the agreement's Shipper can fund it.
- Funding is allowed only after Carrier acceptance.
- The Shipper must send the exact `contractValue`.
- ETH remains in the contract until a verified payout or refund.
- The Carrier submits evidence for the next milestone in sequence.
- The contract stores a `keccak256` hash of the evidence reference.
- Only the Shipper can confirm the submitted evidence.
- Confirmation transfers the corresponding payout to the Carrier.
- The final payout uses the exact remainder to avoid rounding dust.

Relevant code: `fundAgreement()`, `submitMilestoneEvidence()`, `confirmNextMilestone()`.

### 4. Timeout, Refund & Dispute Handling
- Evidence submission and confirmation are blocked after the deadline.
- An accepted but unfunded agreement can be cancelled by its Carrier.
- An incomplete funded agreement becomes eligible for settlement after its deadline.
- Completed milestone payments are irreversible because those services were verified.
- Only the unreleased escrow balance is refunded to the Shipper.
- `settleExpiredAgreement` either acc can execute it.

Relevant code: `cancelUnfundedAgreement()`, `settleExpiredAgreement()`, `claimRefund()`, `nonReentrant()`.

## Role permissions
| Action                           | Shipper | Carrier |
| Register wallet role                 | Yes | Yes |
| Create agreement                     | Yes | No  |
| Accept agreement                     | No  | Yes |
| Fund escrow                          | Yes | No  |
| Submit milestone evidence            | No  | Yes |
| Confirm evidence and release payout  | Yes | No  |
| Cancel accepted & unfunded agreement | No  | Yes |
| Settle an expired agreement          | Yes | Yes |
| View agreements and events           | Yes | Yes |

## Evidence feature
The Carrier may submit e.g. tracking number, customs reference, document URL etc.
The contract stores the reference and its `keccak256` hash. 
Hence a changed reference produces a different hash which makes alteration detectable.
The hash proves that a specific reference was recorded in a specific blockchain transaction. 

## Frontend blockchain library
The frontend uses **Ethers.js 6.13.4**, loaded in `index.html`. 
It creates an `ethers.BrowserProvider` around MetaMask's injected `window.ethereum` provider. 
`BrowserProvider` is the Ethers v6 replacement for the older Ethers v5 `Web3Provider`.

## Transaction history
CarGrow reads emitted contract events and shows registration, agreement creation/acceptance/funding, evidence submissions, milestone payouts, cancellations and refunds in chronological order. 
Each entry can be opened to inspect its timestamp, block, transaction hash, agreement/event values, and transferred amount where applicable. 
Current escrow balance is derived from the agreement's `contractValue - releasedAmount` and shown on Agreement Details.

## Milestone percentages
This implementation fixes milestone distributions at **30% / 30% / 40%**. 
Fixed percentages are easier to validate, demonstrate and audit.

##  ERC-20 reputation token replaced by Carrier reputation points
CarGrow implements simpler non-transferable on-chain reputation points instead of a tradeable token. Reputation never replaces escrow ETH.

The implemented reputation feature is deliberately simpler than a transferable ERC-20 token. A Carrier earns 10 points only when all three milestones are confirmed and the agreement becomes Completed.
 Partial or expired agreements award no points.

Can be earned           : Yes
Can be displayed        : Yes
Can be transferred      : No
Can be purchased        : No

## Set Up guide with Ganache

1. Install Node.js, MetaMask, and Ganache.
2. Start Ganache at `http://127.0.0.1:7545`.
3. Import two different Ganache accounts into MetaMask.
4. Select the same Ganache network in both browser profiles.
5. Run:

## powershell
npm install
npm run compile
npm run deploy:ganache

6. Copy the printed address into `CONTRACT_ADDRESS` at the top of `js/app.js`.
7. Start the UI with `npm run serve`.
8. Open `http://127.0.0.1:5500` in browser profiles.
9. Register one account as Shipper and the other as Carrier.

Whenever Solidity changes, redeploy and update `CONTRACT_ADDRESS`.
An old address continues to reference the old contract version.
**ENSURE NETWORK ID IS 1337 FOR GANACHE AND METAMASK**
