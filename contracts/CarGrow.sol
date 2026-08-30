// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================================
// CARGROW SMART-CONTRACT FEATURE MAP
// 1. Registration assigns each wallet a permanent Shipper or Carrier role.
// 2. Agreements create and validate logistics records with fixed milestones.
// 3. Escrow holds exact ETH funding and releases verified 30/30/40 payouts.
// 4. Evidence requires Carrier submission and Shipper confirmation.
// 5. Resolution supports cancellation and remaining-balance refunds.
// 6. Reputation awards 10 non-transferable points on final completion.
// 7. Read functions expose agreement state to the JavaScript frontend.
// ============================================================================
contract CarGrow {
    // ================================================================
    // DATA MODEL AND SHARED CONTRACT STATE
    // ================================================================
    // Role and Status are stored as small enum numbers on-chain. The UI
    // translates those numbers into readable labels such as "Shipper".
    enum Role { None, Shipper, Carrier }
    enum Status { Open, Accepted, Funded, Completed, Cancelled, Refunded }

    struct User { Role role; bool registered; }
    struct Milestone {
        string description;
        uint16 payoutBps;
        bool evidenceSubmitted;
        bytes32 evidenceHash;
        string evidenceReference;
        bool completed;
        uint256 paidAmount;
    }
    struct Agreement {
        uint256 id;
        address payable shipper;
        address payable carrier;
        string cargoDescription;
        string origin;
        string destination;
        uint256 contractValue;
        uint64 deadline;
        uint64 acceptedAt;
        Status status;
        uint8 completedMilestones;
        uint256 releasedAmount;
    }

    uint256 public constant FUNDING_WINDOW = 48 hours;
    uint16 private constant BPS = 10_000;
    uint256 public agreementCount;
    bool private locked;
    mapping(address => User) public users;
    // Non-transferable reputation points. They are earned from successful
    // agreements and cannot be purchased, approved, or sent to another wallet.
    mapping(address => uint256) public reputationPoints;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => Milestone[3]) private milestones;

    event UserRegistered(address indexed account, Role role);
    event AgreementCreated(uint256 indexed agreementId, address indexed shipper, uint256 value, uint256 deadline);
    event AgreementAccepted(uint256 indexed agreementId, address indexed carrier);
    event AgreementFunded(uint256 indexed agreementId, uint256 amount);
    event MilestoneEvidenceSubmitted(uint256 indexed agreementId, uint8 indexed milestoneIndex, bytes32 evidenceHash, string evidenceReference);
    event MilestoneCompleted(uint256 indexed agreementId, uint8 indexed milestoneIndex, uint256 payout);
    event ReputationAwarded(address indexed carrier, uint256 indexed agreementId, uint256 points);
    event AgreementCancelled(uint256 indexed agreementId);
    event RefundClaimed(uint256 indexed agreementId, uint256 amount);

    // Reusable access and safety checks. `msg.sender` is the wallet that
    // signed the current MetaMask transaction.
    modifier onlyRole(Role role) { require(users[msg.sender].role == role, "Incorrect role"); _; }
    modifier validAgreement(uint256 id) { require(id > 0 && id <= agreementCount, "Agreement not found"); _; }
    modifier nonReentrant() { require(!locked, "Reentrant call"); locked = true; _; locked = false; }

    // ================================================================
    // 1. USER REGISTRATION & ACCESS CONTROL POLICY
    // ================================================================
    // One wallet can register once as either Shipper or Carrier. Because
    // there is no role-changing function, the selected role is permanent
    // for the lifetime of this deployed contract.
    function registerUser(Role role) external {
        require(!users[msg.sender].registered, "Wallet already registered");
        require(role == Role.Shipper || role == Role.Carrier, "Invalid role");
        users[msg.sender] = User(role, true);
        emit UserRegistered(msg.sender, role);
    }

    // ================================================================
    // 2. AGREEMENT CREATION & VALIDATION POLICY
    // ================================================================
    // Only a registered Shipper can call this function. It validates the
    // essential agreement terms, creates an Open agreement, and fixes the
    // milestone distribution at 30%, 30%, and 40% (10,000 basis points).
    function createAgreement(
        string calldata cargoDescription,
        string calldata origin,
        string calldata destination,
        uint256 contractValue,
        uint64 deadline
    ) external onlyRole(Role.Shipper) returns (uint256 id) {
        require(bytes(cargoDescription).length > 0, "Cargo required");
        require(contractValue > 0, "Value must be positive");
        require(deadline > block.timestamp, "Deadline must be future");
        id = ++agreementCount;
        agreements[id] = Agreement(id, payable(msg.sender), payable(address(0)), cargoDescription, origin, destination, contractValue, deadline, 0, Status.Open, 0, 0);
        milestones[id][0] = Milestone("Cargo Pickup at Origin", 3000, false, bytes32(0), "", false, 0);
        milestones[id][1] = Milestone("In-Transit / Customs Clearance", 3000, false, bytes32(0), "", false, 0);
        milestones[id][2] = Milestone("Final Delivery to Destination", 4000, false, bytes32(0), "", false, 0);
        emit AgreementCreated(id, msg.sender, contractValue, deadline);
    }

    // A Carrier accepts an Open agreement before its deadline. The stored
    // carrier address prevents other carriers from managing this shipment.
    function acceptAgreement(uint256 id) external onlyRole(Role.Carrier) validAgreement(id) {
        Agreement storage a = agreements[id];
        require(a.status == Status.Open, "Agreement unavailable");
        require(block.timestamp < a.deadline, "Agreement expired");
        require(msg.sender != a.shipper, "Self-dealing prohibited");
        a.carrier = payable(msg.sender);
        a.acceptedAt = uint64(block.timestamp);
        a.status = Status.Accepted;
        emit AgreementAccepted(id, msg.sender);
    }

    // ================================================================
    // 3. FINANCIAL ESCROW & FUNDING POLICY
    // ================================================================
    // The original Shipper deposits exactly `contractValue`. `payable`
    // allows the function to receive ETH, which stays in this contract
    // until verified payouts or an expiry refund transfers it elsewhere.
    function fundAgreement(uint256 id) external payable onlyRole(Role.Shipper) validAgreement(id) {
        Agreement storage a = agreements[id];
        require(msg.sender == a.shipper, "Not agreement shipper");
        require(a.status == Status.Accepted, "Not awaiting funding");
        require(block.timestamp <= uint256(a.acceptedAt) + FUNDING_WINDOW, "Funding window expired");
        require(block.timestamp < a.deadline, "Agreement expired");
        require(msg.value == a.contractValue, "Send exact contract value");
        a.status = Status.Funded;
        emit AgreementFunded(id, msg.value);
    }

    // The assigned Carrier submits evidence for the next milestone only.
    // The reference may be an IPFS CID, tracking number, or document URL.
    // keccak256 creates a tamper-evident fingerprint stored on-chain.
    function submitMilestoneEvidence(uint256 id, string calldata evidenceReference) external onlyRole(Role.Carrier) validAgreement(id) {
        Agreement storage a = agreements[id];
        require(msg.sender == a.carrier, "Not assigned carrier");
        require(a.status == Status.Funded, "Agreement not funded");
        require(block.timestamp < a.deadline, "Deadline passed");
        uint8 index = a.completedMilestones;
        require(index < 3, "All milestones complete");
        Milestone storage m = milestones[id][index];
        require(!m.evidenceSubmitted, "Evidence already submitted");
        bytes memory referenceBytes = bytes(evidenceReference);
        require(referenceBytes.length >= 3 && referenceBytes.length <= 200, "Invalid evidence reference");
        m.evidenceSubmitted = true;
        m.evidenceReference = evidenceReference;
        m.evidenceHash = keccak256(referenceBytes);
        emit MilestoneEvidenceSubmitted(id, index, m.evidenceHash, evidenceReference);
    }

    // The Shipper reviews the submitted evidence and confirms it. Only this
    // confirmation releases ETH, so a Carrier cannot approve its own claim.
    // Milestones are sequential because the index equals completedMilestones.
    function confirmNextMilestone(uint256 id) external onlyRole(Role.Shipper) validAgreement(id) nonReentrant {
        Agreement storage a = agreements[id];
        require(msg.sender == a.shipper, "Not agreement shipper");
        require(a.status == Status.Funded, "Agreement not funded");
        require(block.timestamp < a.deadline, "Deadline passed");
        uint8 index = a.completedMilestones;
        require(index < 3, "All milestones complete");
        Milestone storage m = milestones[id][index];
        require(m.evidenceSubmitted, "Evidence not submitted");
        // The last milestone receives the exact remainder. This avoids
        // leaving small amounts behind because of integer division rounding.
        uint256 payout = index == 2 ? a.contractValue - a.releasedAmount : (a.contractValue * m.payoutBps) / BPS;
        // Checks-effects-interactions: update all state before sending ETH.
        m.completed = true;
        m.paidAmount = payout;
        a.completedMilestones = index + 1;
        a.releasedAmount += payout;
        if (a.completedMilestones == 3) {
            a.status = Status.Completed;
            // Award only after final delivery; partial agreements earn nothing.
            reputationPoints[a.carrier] += 10;
            emit ReputationAwarded(a.carrier, id, 10);
        }
        // `call` transfers the verified payout. nonReentrant prevents the
        // recipient contract from re-entering this function during transfer.
        (bool ok,) = a.carrier.call{value: payout}("");
        require(ok, "Payout failed");
        emit MilestoneCompleted(id, index, payout);
    }

    // The assigned Carrier may withdraw before the Shipper funds escrow.
    // A funded agreement cannot be cancelled through this function.
    function cancelUnfundedAgreement(uint256 id) external onlyRole(Role.Carrier) validAgreement(id) {
        Agreement storage a = agreements[id];
        require(msg.sender == a.carrier, "Not assigned carrier");
        require(a.status == Status.Accepted, "Cannot cancel");
        a.status = Status.Cancelled;
        emit AgreementCancelled(id);
    }

    // ================================================================
    // 4. TIMEOUT, REFUND & DISPUTE HANDLING POLICY
    // ================================================================
    /// @notice Finalizes an expired agreement and returns every wei still held in escrow.
    /// Anyone may call this, which allows an automation service to settle on schedule.
    function settleExpiredAgreement(uint256 id) external validAgreement(id) nonReentrant {
        Agreement storage a = agreements[id];
        require(a.status == Status.Funded, "Agreement is not funded");
        require(block.timestamp >= a.deadline, "Deadline not reached");
        require(a.completedMilestones < 3, "Agreement already completed");
        // Completed milestone payouts remain with the Carrier. Only the
        // unreleased portion is still available and therefore refundable.
        uint256 refund = a.contractValue - a.releasedAmount;
        a.status = Status.Refunded;
        if (refund > 0) {
            (bool ok,) = a.shipper.call{value: refund}("");
            require(ok, "Refund failed");
        }
        emit RefundClaimed(id, refund);
    }

    // Shipper-specific alternative to public settlement. It applies the same
    // remaining-escrow rule and exists as a clear user-facing refund action.
    function claimRefund(uint256 id) external onlyRole(Role.Shipper) validAgreement(id) nonReentrant {
        Agreement storage a = agreements[id];
        require(msg.sender == a.shipper, "Not agreement shipper");
        require(a.status == Status.Funded, "No refundable escrow");
        require(block.timestamp >= a.deadline, "Deadline not reached");
        uint256 refund = a.contractValue - a.releasedAmount;
        require(refund > 0, "Nothing to refund");
        a.status = Status.Refunded;
        (bool ok,) = a.shipper.call{value: refund}("");
        require(ok, "Refund failed");
        emit RefundClaimed(id, refund);
    }

    // ================================================================
    // READ-ONLY FUNCTIONS USED BY THE FRONTEND
    // ================================================================
    // View calls require no MetaMask transaction and consume no user gas.
    function getAgreement(uint256 id) external view validAgreement(id) returns (Agreement memory, Milestone[3] memory) {
        return (agreements[id], milestones[id]);
    }

    function getAgreementStatus(uint256 id) external view validAgreement(id) returns (Status) {
        Agreement memory a = agreements[id];
        // This reports the logical expired/refund state for display. The ETH
        // transfer and permanent status update occur during settlement.
        if (a.status == Status.Funded && block.timestamp >= a.deadline && a.completedMilestones < 3) return Status.Refunded;
        return a.status;
    }
}
