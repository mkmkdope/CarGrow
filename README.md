# CarGrow

**Move Cargo. Grow Trust.**

CarGrow is a role-based Ethereum dApp for milestone logistics escrow. A Shipper creates and funds an agreement, a Carrier submits milestone evidence, and the Shipper verifies that evidence before the `CarGrow` Solidity contract releases each 30% / 30% / 40% payout.

## How the system works

```text
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
```

If the deadline passes before completion, no more evidence or milestone confirmations are permitted. Previously verified payments remain with the Carrier, while every wei still held in escrow is returned to the Shipper during settlement.

## Policy and smart-contract mapping

### 1. User Registration & Access Control Policy

- A wallet registers once as either Shipper or Carrier.
- One wallet cannot hold both roles.
- The role is permanent for the current deployment.
- MetaMask proves wallet ownership by signing transactions.
- Solidity uses `msg.sender` as the authenticated identity.
- `onlyRole()` prevents unauthorized role actions.

Relevant code: `registerUser()`, `onlyRole()`, and `users`.

### 2. Agreement Creation & Validation Policy

- Only a registered Shipper can create an agreement.
- Cargo description, positive ETH value, and a future deadline are mandatory.
- Every agreement begins with the `Open` status.
- Milestones are Cargo Pickup 30%, In-Transit/Customs 30%, and Final Delivery 40%.
- Only a registered Carrier can accept an Open, unexpired agreement.
- The accepted Carrier address is stored against that agreement.

Relevant code: `createAgreement()`, `acceptAgreement()`, `agreements`, and `milestones`.

### 3. Financial Escrow & Funding Policy

- Only the agreement's Shipper can fund it.
- Funding is allowed only after Carrier acceptance.
- The Shipper must send the exact `contractValue`.
- ETH remains in the contract until a verified payout or refund.
- The Carrier submits evidence for the next milestone in sequence.
- The contract stores a `keccak256` hash of the evidence reference.
- Only the Shipper can confirm the submitted evidence.
- Confirmation transfers the corresponding payout to the Carrier.
- The final payout uses the exact remainder to avoid rounding dust.

Relevant code: `fundAgreement()`, `submitMilestoneEvidence()`, and `confirmNextMilestone()`.

### 4. Timeout, Refund & Dispute Handling Policy

- Evidence submission and confirmation are blocked after the deadline.
- An accepted but unfunded agreement can be cancelled by its Carrier.
- An incomplete funded agreement becomes eligible for settlement after its deadline.
- Completed milestone payments are irreversible because those services were verified.
- Only the unreleased escrow balance is refunded to the Shipper.
- `settleExpiredAgreement()` is public so either party or an automation account can execute it.
- `claimRefund()` provides a Shipper-only alternative.
- A reentrancy lock protects ETH transfers.

Relevant code: `cancelUnfundedAgreement()`, `settleExpiredAgreement()`, `claimRefund()`, and `nonReentrant()`.

## Agreement status lifecycle

```text
Open
  ├── Carrier accepts → Accepted
  │                      ├── Shipper funds → Funded
  │                      │                   ├── 3 confirmations → Completed
  │                      │                   └── Deadline expires → Refunded
  │                      └── Carrier cancels → Cancelled
  └── Remains available until its deadline
```

The UI displays `Expired — refund pending` between deadline expiry and the successful settlement transaction.

## Role permissions

| Action | Shipper | Carrier |
|---|:---:|:---:|
| Register wallet role | Yes | Yes |
| Create agreement | Yes | No |
| Accept agreement | No | Yes |
| Fund escrow | Yes | No |
| Submit milestone evidence | No | Yes |
| Confirm evidence and release payout | Yes | No |
| Cancel accepted, unfunded agreement | No | Yes |
| Settle an expired agreement | Yes | Yes |
| View agreements and events | Yes | Yes |

## Evidence model

The Carrier may submit a tracking number, IPFS CID, customs reference, document URL, or proof-of-delivery identifier. The contract stores the reference and its `keccak256` hash. A changed reference produces a different hash, making alteration detectable.

The hash proves that a specific reference was recorded in a specific blockchain transaction. It does not independently prove physical delivery; Shipper review supplies the second-party verification step.

## Frontend blockchain library

The frontend uses **Ethers.js 6.13.4**, loaded in `index.html`. It creates an `ethers.BrowserProvider` around MetaMask's injected `window.ethereum` provider. `BrowserProvider` is the Ethers v6 replacement for the older Ethers v5 `Web3Provider`; this project does not use the separate Web3.js library.

## Transaction history meaning

The assignment's transaction-history requirement means users should be able to reconstruct their participation and important agreement activity. CarGrow reads emitted contract events and shows registration, agreement creation/acceptance/funding, evidence submissions, milestone payouts, cancellations, and refunds in chronological order. Each entry can be opened to inspect its timestamp, block, transaction hash, agreement/event values, and transferred amount where applicable. Current escrow balance is derived from the agreement's `contractValue - releasedAmount` and shown on Agreement Details.

## Milestone percentages

This implementation fixes milestone distributions at **30% / 30% / 40%**. That directly fulfils the requirement to define the relationship between contract funds and milestone distributions. User-adjustable percentages are optional, not mandatory. Fixed percentages are easier to validate, demonstrate, and audit; adjustable percentages would require arrays, a total-equals-100% validation rule, and a more complex creation UI.

## Optional ERC-20 reputation token

The assignment says the team *may* define a token standard, so a complete ERC-20 token is optional. CarGrow implements simpler non-transferable on-chain reputation points instead of a tradeable token. Reputation never replaces escrow ETH.

## Carrier reputation points

The implemented reputation feature is deliberately simpler than a transferable ERC-20 token. A Carrier earns **10 points only when all three milestones are confirmed and the agreement becomes Completed**. Partial or expired agreements award no points. Points are stored in `reputationPoints[carrier]` and displayed on the Carrier dashboard.

```text
Can be earned:      Yes
Can be displayed:   Yes
Can be transferred: No
Can be purchased:   No
```

This prevents carriers from buying or moving reputation between wallets. `ReputationAwarded` events also appear in transaction history.

## Run locally with Ganache

1. Install Node.js, MetaMask, and Ganache.
2. Start Ganache at `http://127.0.0.1:7545`.
3. Import two different Ganache accounts into MetaMask.
4. Select the same Ganache network in both browser profiles.
5. Run:

```powershell
npm install
npm run compile
npm test
npm run deploy:ganache
```

6. Copy the printed address into `CONTRACT_ADDRESS` at the top of `js/app.js`.
7. Start the UI with `npm run serve`.
8. Open `http://127.0.0.1:5500` in both browser profiles.
9. Register one account as Shipper and the other as Carrier.

Whenever Solidity changes, redeploy and update `CONTRACT_ADDRESS`. An old address continues to reference the old contract version.

## Generated Hardhat folders and cleanup

Hardhat creates these directories whenever the contract is compiled or tested:

```text
artifacts/
cache/
```

They are safe to delete because they contain generated build data rather than project source code:

- `artifacts/` contains compiled ABI, bytecode, debug metadata, and build information.
- `cache/` records compiler input and output metadata so later compilations can run faster.
- Neither directory stores Solidity source, frontend code, Ganache wallets, private keys, deployed contract state, or transaction history.
- Both directories are excluded by `.gitignore` because another developer can recreate them locally.

Regenerate them at any time with:

```powershell
npm run compile
```

Running the tests also compiles automatically:

```powershell
npm test
```

Deleting these folders does **not** undeploy a contract from Ganache. Ganache blockchain state exists inside the active Ganache workspace. To reset deployed agreements and registrations, you would reset/change the Ganache workspace or deploy a new contract—not delete Hardhat's build folders.

Do not delete the following project source files during cleanup:

```text
contracts/CarGrow.sol
scripts/deploy.js
test/CarGrow.test.js
js/app.js
index.html
css/
hardhat.config.js
package.json
package-lock.json
README.md
```

## Suggested demonstration sequence

1. Register Browser A as Shipper and Browser B as Carrier.
2. Shipper creates an agreement.
3. Carrier accepts it.
4. Shipper funds the exact ETH value.
5. Carrier submits evidence for Cargo Pickup.
6. Shipper reviews and confirms the evidence.
7. Show the automatic 30% payout and reduced escrow balance.
8. Repeat for later milestones, or demonstrate expiry using another agreement.

## Deadline settlement limitation

Ethereum contracts cannot wake themselves up when time passes. `block.timestamp` verifies the deadline, but an account must submit the settlement transaction. On Ganache, either user can click **Settle expired agreement**. On a public testnet, a keeper or automation service could call `settleExpiredAgreement()`.

## Troubleshooting

### “Could not decode result data” or “No CarGrow contract exists”

Check that:

1. Ganache is running on port `7545`.
2. MetaMask shows Ganache, not Ethereum Mainnet (`chain 1`).
3. Both browsers use the same Ganache workspace and chain ID.
4. `CONTRACT_ADDRESS` contains the newest deployment address.
5. You hard-refreshed using `Ctrl+F5` after changing it.

Ports `5500` and `8080` serve the frontend; they do not identify the blockchain. A username/password prompt means another program is occupying that web port.

## Security scope

This project is intended for coursework and local demonstration. It includes role checks, state validation, exact-value funding, sequential milestones, evidence hashing, checks-effects-interactions, and a reentrancy lock. It has not received a professional security audit and should not hold real funds.
