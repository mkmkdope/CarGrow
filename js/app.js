// CONTRACT CONFIGURATION AND ABI
// Replace this address after each Ganache redeployment.
const CONTRACT_ADDRESS = "0x4F0EFFf9c42b3217Bd1eb909D2468Df041407b5c";
const ABI = [
  "function agreementCount() view returns (uint256)",
  "function users(address) view returns (uint8 role,bool registered)",
  "function reputationPoints(address) view returns (uint256)",
  "function registerUser(uint8 role)",
  "function createAgreement(string cargoDescription,string origin,string destination,uint256 contractValue,uint64 deadline) returns (uint256)",
  "function acceptAgreement(uint256 id)",
  "function fundAgreement(uint256 id) payable",
  "function submitMilestoneEvidence(uint256 id,string evidenceReference)",
  "function confirmNextMilestone(uint256 id)",
  "function cancelUnfundedAgreement(uint256 id)",
  "function claimRefund(uint256 id)",
  "function settleExpiredAgreement(uint256 id)",
  "function getAgreement(uint256 id) view returns ((uint256 id,address shipper,address carrier,string cargoDescription,string origin,string destination,uint256 contractValue,uint64 deadline,uint64 acceptedAt,uint8 status,uint8 completedMilestones,uint256 releasedAmount),(string description,uint16 payoutBps,bool evidenceSubmitted,bytes32 evidenceHash,string evidenceReference,bool completed,uint256 paidAmount)[3])",
  "event UserRegistered(address indexed account,uint8 role)",
  "event AgreementCreated(uint256 indexed agreementId,address indexed shipper,uint256 value,uint256 deadline)",
  "event AgreementAccepted(uint256 indexed agreementId,address indexed carrier)",
  "event AgreementFunded(uint256 indexed agreementId,uint256 amount)",
  "event MilestoneEvidenceSubmitted(uint256 indexed agreementId,uint8 indexed milestoneIndex,bytes32 evidenceHash,string evidenceReference)",
  "event MilestoneCompleted(uint256 indexed agreementId,uint8 indexed milestoneIndex,uint256 payout)",
  "event ReputationAwarded(address indexed carrier,uint256 indexed agreementId,uint256 points)",
  "event AgreementCancelled(uint256 indexed agreementId)",
  "event RefundClaimed(uint256 indexed agreementId,uint256 amount)",
];

// FRONTEND STATE AND FORMATTING
// Browser state stores the wallet, role, current view, filters, and decoded data
const $ = (s) => document.querySelector(s);
const state = {
  provider: null,
  signer: null,
  contract: null,
  account: null,
  role: 0,
  reputation: 0n,
  agreements: [],
  selectedRole: 0,
  agreementView: { sortBy: "deadline", direction: "desc", status: "all" },
  historyView: { scope: "mine", direction: "desc" },
  currentView: "dashboard",
  currentDetailId: null,
  currentAgreementList: null,
  allHistoryEvents: [],
  historyEvents: [],
};
const statuses = [
  "Open",
  "Pending funding",
  "Funded",
  "Completed",
  "Cancelled",
  "Refunded",
];
const short = (a) =>
  a && a !== ethers.ZeroAddress
    ? `${a.slice(0, 6)}…${a.slice(-4)}`
    : "Not assigned";
const eth = (n) =>
  `${Number(ethers.formatEther(n)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  })} ETH`;
const date = (n) =>
  new Date(Number(n) * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[
        c
      ]),
  );
function toast(message, error = false) {
  const t = $("#toast");
  t.textContent = message;
  t.className = `toast show${error ? " error" : ""}`;
  setTimeout(() => (t.className = "toast"), 3500);
}
function parseError(e) {
  return (
    e?.reason ||
    e?.shortMessage ||
    e?.message?.split("(")[0] ||
    "Transaction failed"
  );
}
function configured() {
  return ethers.isAddress(CONTRACT_ADDRESS);
}

// Reusable Edit/Confirm dialog shown before irreversible transactions.
function confirmReview(title, rows, confirmLabel = "Confirm") {
  return new Promise((resolve) => {
    const dialog = $("#confirmDialog");
    $("#confirmTitle").textContent = title;
    $("#confirmBody").innerHTML = rows
      .map(
        ([label, value]) =>
          `<div class="confirm-line"><span>${escapeHtml(
            label,
          )}</span><b>${escapeHtml(value)}</b></div>`,
      )
      .join("");
    $("#dialogConfirm").textContent = confirmLabel;
    $("#dialogEdit").onclick = () => {
      dialog.close();
      resolve(false);
    };
    $("#dialogConfirm").onclick = () => {
      dialog.close();
      resolve(true);
    };
    dialog.oncancel = (e) => {
      e.preventDefault();
      dialog.close();
      resolve(false);
    };
    dialog.showModal();
  });
}

// METAMASK CONNECTION, NETWORK CHECK AND ROLE REGISTRATION
async function verifyContractConnection() {
  const network = await state.provider.getNetwork();
  const code = await state.provider.getCode(CONTRACT_ADDRESS);
  if (code === "0x") {
    throw Error(
      `No CarGrow contract exists at ${CONTRACT_ADDRESS} on chain ${network.chainId}. Select the same Ganache network used for deployment, or update CONTRACT_ADDRESS after redeploying.`,
    );
  }
}

async function connect() {
  try {
    if (!window.ethereum) throw Error("Install MetaMask to use CarGrow.");
    if (!configured())
      throw Error(
        "Deploy the contract and set CONTRACT_ADDRESS in js/app.js first.",
      );
    state.provider = new ethers.BrowserProvider(window.ethereum);
    await state.provider.send("eth_requestAccounts", []);
    state.signer = await state.provider.getSigner();
    state.account = await state.signer.getAddress();
    await verifyContractConnection();
    state.contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, state.signer);
    const user = await state.contract.users(state.account);
    state.role = Number(user.role);
    $("#landing").classList.add("hidden");
    if (!user.registered) $("#roleScreen").classList.remove("hidden");
    else await enterApp();
  } catch (e) {
    toast(parseError(e), true);
  }
}
async function register() {
  try {
    const role = state.selectedRole === 1 ? "Shipper" : "Carrier";
    if (
      !(await confirmReview(
        "Register permanent wallet role",
        [
          ["Wallet", state.account],
          ["Role", role],
          ["Important", "This role cannot be changed"],
        ],
        `Register as ${role}`,
      ))
    )
      return;
    const tx = await state.contract.registerUser(state.selectedRole);
    toast("Registration submitted…");
    await tx.wait();
    state.role = state.selectedRole;
    $("#roleScreen").classList.add("hidden");
    await enterApp();
  } catch (e) {
    toast(parseError(e), true);
  }
}
async function enterApp() {
  $("#app").classList.remove("hidden");
  $("#walletShort").textContent = short(state.account);
  $("#roleLabel").textContent =
    state.role === 1 ? "SHIPPER PORTAL" : "CARRIER PORTAL";
  const items =
    state.role === 1
      ? [
          ["dashboard", "Dashboard"],
          ["agreements", "My Agreements"],
          ["create", "Create Agreement"],
          ["history", "Transaction History"],
        ]
      : [
          ["dashboard", "Dashboard"],
          ["available", "Available Agreements"],
          ["agreements", "My Agreements"],
          ["history", "Transaction History"],
        ];
  $("#sidebar").innerHTML = items
    .map(
      ([id, label]) =>
        `<button class="nav-btn" data-view="${id}">${label}</button>`,
    )
    .join("");
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
  await loadAgreements();
  const saved =
      sessionStorage.getItem(`cargrow:view:${state.account}`) || "dashboard",
    savedId = Number(sessionStorage.getItem(`cargrow:detail:${state.account}`));
  if (
    saved === "details" &&
    savedId &&
    state.agreements.some((x) => Number(x.a.id) === savedId)
  )
    details(savedId);
  else navigate(items.some(([id]) => id === saved) ? saved : "dashboard");
}
// BLOCKCHAIN DATA LOADING
// Read-only calls load agreements, milestones and reputation.
async function loadAgreements() {
  const [countRaw, reputation] = await Promise.all([
    state.contract.agreementCount(),
    state.contract.reputationPoints(state.account),
  ]);
  state.reputation = reputation;
  const count = Number(countRaw);
  const calls = [];
  for (let i = 1; i <= count; i++) calls.push(state.contract.getAgreement(i));
  state.agreements = (await Promise.all(calls)).map(
    ([agreement, milestones]) => ({ a: agreement, m: milestones }),
  );
}
// NAVIGATION, STATUS MAPPING, AGREEMENT LISTS AND FILTERS
// The active page is remembered per wallet.
function mine(x) {
  return state.role === 1
    ? x.a.shipper.toLowerCase() === state.account.toLowerCase()
    : x.a.carrier.toLowerCase() === state.account.toLowerCase();
}
function navActive(id) {
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === id));
}
function headings(kicker, title) {
  $("#pageKicker").textContent = kicker;
  $("#pageTitle").textContent = title;
}
function rememberView(view, id = null) {
  state.currentView = view;
  state.currentDetailId = id;
  sessionStorage.setItem(`cargrow:view:${state.account}`, view);
  if (id) sessionStorage.setItem(`cargrow:detail:${state.account}`, String(id));
}
function navigate(view) {
  rememberView(view);
  navActive(view);
  if (view === "dashboard") dashboard();
  if (view === "agreements") {
    state.agreementView.status = "all";
    listAgreements(
      state.agreements.filter(mine),
      "MY CONTRACTS",
      "My Agreements",
    );
  }
  if (view === "available")
    listAgreements(
      state.agreements.filter((x) => Number(x.a.status) === 0),
      "MARKETPLACE",
      "Available Agreements",
    );
  if (view === "create") createView();
  if (view === "history") historyView();
}
function statusClass(a) {
  const status = Number(a.status);
  return status === 5 ? " refunded" : status === 4 ? " cancelled" : "";
}
function row(x) {
  const a = x.a;
  return `<div class="card agreement-row"><b>LG-${String(a.id).padStart(
    4,
    "0",
  )}</b><div>${escapeHtml(a.cargoDescription)}<br><small>${escapeHtml(
    a.origin || "Origin",
  )} → ${escapeHtml(a.destination || "Destination")}</small></div><span>${eth(
    a.contractValue,
  )}</span><span class="badge${statusClass(a)}">${statusOf(
    a,
  )}</span><button class="ghost" onclick="details(${
    a.id
  })">View</button></div>`;
}
function isExpired(a) {
  return (
    Number(a.status) === 2 &&
    Date.now() / 1000 >= Number(a.deadline) &&
    Number(a.completedMilestones) < 3
  );
}
function statusOf(a) {
  if (isExpired(a)) return "Expired — refund pending";
  return statuses[Number(a.status)];
}
function applyAgreementView(items) {
  const { sortBy, direction, status } = state.agreementView;
  const filtered =
    status === "all" ? items : items.filter((x) => statusOf(x.a) === status);
  return [...filtered].sort((x, y) => {
    let a, b;
    if (sortBy === "deadline") {
      a = Number(x.a.deadline);
      b = Number(y.a.deadline);
    }
    if (sortBy === "value") {
      a = x.a.contractValue;
      b = y.a.contractValue;
    }
    if (sortBy === "status") {
      a = statusOf(x.a);
      b = statusOf(y.a);
    }
    const result = a < b ? -1 : a > b ? 1 : 0;
    return direction === "asc" ? result : -result;
  });
}
function listAgreements(items, kicker, title) {
  state.currentAgreementList = { items, kicker, title };
  const visible = applyAgreementView(items);
  headings(kicker, title);
  const label = `${state.agreementView.sortBy} · ${state.agreementView.direction}`;
  $("#view").innerHTML = `<div class="section-head"><h3>${visible.length} of ${
    items.length
  } agreement${
    items.length === 1 ? "" : "s"
  }</h3><button class="ghost filter-only" onclick="openAgreementFilter()" aria-label="Filter and sort agreements" title="Filter and sort agreements">
  <span class="filter-icon" aria-hidden="true"></span></button></div>
  <div class="list-columns"><span>Agreement</span><span>Cargo / Route</span><span>ETH amount</span><span>Status</span>
  <span>Action</span></div><div class="agreement-list">${
    visible.length
      ? visible.map(row).join("")
      : '<div class="card empty">No agreements match the selected filter. Completed agreements remain available when “All statuses” or “Completed” is selected.</div>'
  }</div>`;
}
window.openAgreementFilter = function () {
  const d = $("#filterDialog");
  $("#sortBy").value = state.agreementView.sortBy;
  $("#sortDirection").value = state.agreementView.direction;
  $("#statusFilter").value = state.agreementView.status;
  d.showModal();
};
$("#filterCancel").onclick = () => $("#filterDialog").close();
$("#filterApply").onclick = () => {
  state.agreementView = {
    sortBy: $("#sortBy").value,
    direction: $("#sortDirection").value,
    status: $("#statusFilter").value,
  };
  $("#filterDialog").close();
  if (state.currentAgreementList) {
    const { items, kicker, title } = state.currentAgreementList;
    listAgreements(items, kicker, title);
  }
};
// ROLE DASHBOARD
// Shippers see escrow/release totals; Carriers see earnings and reputation.
function dashboard() {
  headings(
    "OVERVIEW",
    state.role === 1 ? "Shipper Dashboard" : "Carrier Dashboard",
  );
  const own = state.agreements.filter(mine),
    active = own.filter((x) => [1, 2].includes(Number(x.a.status))),
    locked = own.reduce(
      (s, x) =>
        s +
        (Number(x.a.status) === 2
          ? x.a.contractValue - x.a.releasedAmount
          : 0n),
      0n,
    ),
    released = own.reduce((s, x) => s + x.a.releasedAmount, 0n);
  const available = state.agreements.filter(
    (x) => Number(x.a.status) === 0,
  ).length;
  $(
    "#view",
  ).innerHTML = `<div class="stats"><div class="card stat"><span>Active agreements</span><strong>${
    active.length
  }</strong></div><div class="card stat"><span>${
    state.role === 1 ? "Escrow locked" : "Reputation points"
  }</span><strong>${
    state.role === 1 ? eth(locked) : state.reputation.toString()
  }</strong></div><div class="card stat"><span>${
    state.role === 1 ? "Released to carriers" : "Total earned"
  }</span><strong>${eth(
    released,
  )}</strong></div><div class="card stat"><span>Pending milestones</span><strong>${active.reduce(
    (n, x) => n + 3 - Number(x.a.completedMilestones),
    0,
  )}</strong></div></div><div class="section-head"><h3>Recent agreements</h3></div><div class="agreement-list">${
    own.length
      ? own.slice(-4).reverse().map(row).join("")
      : '<div class="card empty">Your on-chain agreements will appear here.</div>'
  }</div>`;
}

// 7. AGREEMENT CREATION AND INPUT VALIDATION
// Builds the form, validates contextual rules, reviews values, then submits the transaction.
function createView(prefill = null) {
  headings("NEW CONTRACT", "Create Agreement");
  const minimum = new Date(Date.now() + 5 * 60 * 1000);
  minimum.setMinutes(minimum.getMinutes() - minimum.getTimezoneOffset());
  $(
    "#view",
  ).innerHTML = `<form id="createForm" class="card form-card" novalidate>
  <p class="form-intro">Enter the shipment terms carefully. You will review every value before MetaMask requests approval.</p><div class="form-grid"><div class="field full"><label for="cargo">Cargo description</label><textarea id="cargo" name="cargo" minlength="5" maxlength="200" required placeholder="e.g. Temperature-controlled medical supplies"></textarea><small>5–200 characters.</small><span class="field-error" data-error-for="cargo"></span></div>
  <div class="field"><label for="origin">Origin</label><input id="origin" name="origin" minlength="2" maxlength="80" required placeholder="Pickup city or facility e.g. Johor Bahru"><span class="field-error" data-error-for="origin"></span></div><div class="field"><label for="destination">Destination</label><input id="destination" name="destination" minlength="2" maxlength="80" required placeholder="Dropoff city or facility e.g. Kuala Lumpur">
  <span class="field-error" data-error-for="destination"></span></div><div class="field"><label for="value">Contract value (ETH)</label><input id="value" name="value" type="number" min="0.0001" max="100000" step="0.0001" required placeholder="1.0000"><small>The exact amount the shipper will later fund.</small><span class="field-error" data-error-for="value"></span></div><div class="field"><label for="deadline">Strict delivery deadline</label><input id="deadline" name="deadline" type="datetime-local" min="${minimum
    .toISOString()
    .slice(
      0,
      16,
    )}" required><small>Must be at least 5 minutes in the future.</small><span class="field-error" data-error-for="deadline"></span></div><div id="formError" class="form-error full" role="alert"></div></div><div class="milestones"><div class="milestone"><i>1</i><span>Cargo Pickup at Origin</span><b>30%</b></div><div class="milestone"><i>2</i><span>In-Transit / Customs Clearance</span><b>30%</b></div><div class="milestone"><i>3</i><span>Final Delivery to Destination</span><b>40%</b></div></div><button class="primary">Review agreement</button></form>`;
  $("#createForm").onsubmit = createAgreement;
  ["cargo", "origin", "destination", "value", "deadline"].forEach((id) =>
    $("#" + id).addEventListener("input", () => validateAgreementField(id)),
  );
  if (prefill) {
    $("#cargo").value = prefill.cargoDescription || "";
    $("#origin").value = prefill.origin || "";
    $("#destination").value = prefill.destination || "";
    $("#value").value = ethers.formatEther(prefill.contractValue);
    const oldDeadline = new Date(Number(prefill.deadline) * 1000);
    oldDeadline.setMinutes(
      oldDeadline.getMinutes() - oldDeadline.getTimezoneOffset(),
    );
    $("#deadline").value = oldDeadline.toISOString().slice(0, 16);
    if (Number(prefill.deadline) * 1000 < Date.now() + 5 * 60 * 1000) {
      $("#formError").textContent =
        "The copied deadline has passed or is too close. Select a new deadline at least 5 minutes from now.";
      validateAgreementField("deadline");
    }
  }
}
function validateAgreementField(id) {
  const input = $("#" + id),
    message = document.querySelector(`[data-error-for="${id}"]`);
  let error = "";
  const value = input.value.trim();
  if (!value) error = "This field is required.";
  else if (id === "cargo" && value.length < 5)
    error = "Cargo description must contain at least 5 characters.";
  else if ((id === "origin" || id === "destination") && value.length < 2)
    error = `${
      id[0].toUpperCase() + id.slice(1)
    } must contain at least 2 characters.`;
  else if (
    id === "destination" &&
    $("#origin").value.trim().toLowerCase() === value.toLowerCase()
  )
    error = "Destination must be different from origin.";
  else if (id === "value" && (Number(value) < 0.0001 || Number(value) > 100000))
    error = "Contract value must be between 0.0001 and 100,000 ETH.";
  else if (
    id === "deadline" &&
    new Date(value).getTime() < Date.now() + 5 * 60 * 1000
  )
    error = "Deadline must be at least 5 minutes from now.";
  message.textContent = error;
  input.classList.toggle("invalid", Boolean(error));
  return !error;
}
async function createAgreement(e) {
  e.preventDefault();
  const form = e.target,
    error = $("#formError");
  error.textContent = "";
  const fields = ["cargo", "origin", "destination", "value", "deadline"];
  if (!fields.map(validateAgreementField).every(Boolean)) return;
  const f = new FormData(form),
    cargo = f.get("cargo").trim(),
    origin = f.get("origin").trim(),
    destination = f.get("destination").trim(),
    value = f.get("value"),
    deadlineDate = new Date(f.get("deadline")),
    deadline = Math.floor(deadlineDate.getTime() / 1000);
  if (origin.toLowerCase() === destination.toLowerCase()) {
    error.textContent = "Origin and destination must be different.";
    return;
  }
  if (deadline * 1000 < Date.now() + 5 * 60 * 1000) {
    error.textContent = "Deadline must be at least 5 minutes in the future.";
    return;
  }
  try {
    if (
      !(await confirmReview(
        "Create this agreement?",
        [
          ["Cargo", cargo],
          ["Route", `${origin} → ${destination}`],
          ["Contract value", `${value} ETH`],
          ["Deadline", deadlineDate.toLocaleString()],
          ["Payouts", "30% / 30% / 40%"],
        ],
        "Create agreement",
      ))
    )
      return;
    const tx = await state.contract.createAgreement(
      cargo,
      origin,
      destination,
      ethers.parseEther(value),
      deadline,
    );
    toast("Creating agreement…");
    await tx.wait();
    await refresh();
    navigate("agreements");
    toast("Agreement created successfully.");
  } catch (err) {
    toast(parseError(err), true);
  }
}
// AGREEMENT DETAILS AND ROLE/STATUS ACTIONS
window.details = function (id) {
  try {
    const x = state.agreements.find((item) => Number(item.a.id) === Number(id));
    if (!x) {
      toast(
        "Agreement could not be loaded. Refreshing the agreement list.",
        true,
      );
      navigate("agreements");
      return;
    }
    const a = x.a,
      status = Number(a.status),
      completedCount = Number(a.completedMilestones),
      milestones = Array.from(x.m || []),
      next = milestones[completedCount];
    let action = "";
    if (state.role === 2 && status === 0)
      action = `<div class="action-panel"><p>Review all shipment terms before accepting responsibility for this agreement.</p><button class="primary" onclick="act('accept',${id})">Accept agreement</button></div>`;
    if (state.role === 1 && status === 1)
      action = `<div class="action-panel"><p>The carrier has accepted. Fund the exact contract value to enable milestone updates.</p><button class="primary" onclick="act('fund',${id},'${
        a.contractValue
      }')">Fund ${eth(a.contractValue)}</button></div>`;
    if (state.role === 2 && status === 1)
      action = `<div class="action-panel"><p>This agreement is waiting for shipper funding. You may cancel your acceptance before it is funded.</p><button class="secondary-danger" onclick="act('cancel',${id})">Cancel acceptance</button></div>`;
    if (
      state.role === 2 &&
      status === 2 &&
      !isExpired(a) &&
      next &&
      !Boolean(next.evidenceSubmitted ?? next[2])
    )
      action = `<div class="action-panel"><p>Submit a tracking number, document URL, IPFS reference, or delivery-proof identifier. Its hash is stored on-chain for tamper detection.</p><div class="field"><label for="evidenceRef">Milestone evidence reference</label><input id="evidenceRef" minlength="3" maxlength="200" placeholder="e.g. IPFS CID, tracking ID, or evidence URL"><small>The shipper must review and confirm this before payment.</small></div>
      <button class="primary" style="margin-top:12px" onclick="submitEvidence(${id})">Review evidence submission</button></div>`;
    if (
      state.role === 2 &&
      status === 2 &&
      !isExpired(a) &&
      Boolean(next?.evidenceSubmitted ?? next?.[2])
    )
      action = `<div class="action-panel"><p>Evidence submitted. Waiting for the shipper to verify it and authorize payout.</p></div>`;
    if (
      state.role === 1 &&
      status === 2 &&
      !isExpired(a) &&
      Boolean(next?.evidenceSubmitted ?? next?.[2])
    )
      action = `<div class="action-panel"><p>Review the carrier's evidence carefully. Confirmation permanently releases this milestone's payment.</p><button class="primary" onclick="act('confirmMilestone',${id})">Confirm evidence & release payment</button></div>`;
    if (isExpired(a))
      action = `<div class="action-panel"><p>The deadline has passed. Milestone updates are blocked. Settling returns all funds that remain in escrow to the shipper.</p><button class="primary danger" onclick="act('settle',${id})">Settle expired agreement</button></div>`;
    if (status === 3)
      action = `<div class="action-panel"><p><b>Agreement completed.</b> All three milestones were verified and the complete escrow value was released to the Carrier. This record remains available for review.</p></div>`;
    if (status === 5)
      action = `<div class="action-panel refund-panel"><p><b>Agreement refunded.</b> The delivery deadline passed before all milestones were completed. Every unreleased escrow fund was returned to the Shipper. Previously verified milestone payments remain with the Carrier.</p></div>`;
    if (status === 4)
      action = `<div class="action-panel cancelled-panel"><p><b>Agreement cancelled.</b> The Carrier withdrew before escrow funding. No ETH was deposited or released, and this agreement remains available as an auditable record.</p>${
        state.role === 1
          ? `<button class="secondary-danger" onclick="recreateAgreement(${id})">Create same agreement</button>`
          : ""
      }</div>`;
    const milestoneHtml = milestones
      .map((m, i) => {
        const done = Boolean(m.completed ?? m[5]),
          submitted = Boolean(m.evidenceSubmitted ?? m[2]),
          description = m.description ?? m[0] ?? `Milestone ${i + 1}`,
          reference = m.evidenceReference ?? m[4] ?? "",
          paid = m.paidAmount ?? m[6] ?? 0n,
          bps = m.payoutBps ?? m[1] ?? 0;
        return `<div class="milestone ${done ? "done" : ""}"><i>${
          done ? "✓" : i + 1
        }</i><span>${escapeHtml(description)}<small><br>${
          done
            ? `Paid ${eth(paid)}`
            : submitted
            ? `Evidence awaiting confirmation: ${escapeHtml(reference)}`
            : "Evidence not submitted"
        }</small></span><b>${Number(bps) / 100}%</b></div>`;
      })
      .join("");
    const contractValue = BigInt(a.contractValue),
      releasedAmount = BigInt(a.releasedAmount),
      unreleased =
        contractValue >= releasedAmount ? contractValue - releasedAmount : 0n,
      remaining = status === 5 ? 0n : unreleased;
    const refundRow =
      status === 5
        ? `<div class="kv"><span>Refunded to Shipper</span><b class="refund-value">${eth(
            unreleased,
          )}</b></div>`
        : "";
    const html = `<div class="detail-grid"><div class="card"><h3>${escapeHtml(
      a.cargoDescription ?? "Agreement",
    )}</h3><div class="kv"><span>Route</span><b>${escapeHtml(
      a.origin ?? "—",
    )} → ${escapeHtml(
      a.destination ?? "—",
    )}</b></div><div class="kv"><span>Shipper</span><b>${short(
      a.shipper,
    )}</b></div><div class="kv"><span>Carrier</span><b>${short(
      a.carrier,
    )}</b></div><div class="kv"><span>Deadline</span><b>${date(
      a.deadline,
    )}</b></div><div class="kv"><span>Status</span><b class="badge${statusClass(
      a,
    )}">${statusOf(
      a,
    )}</b></div><div class="milestones">${milestoneHtml}</div>${action}</div><div class="card"><h3>Escrow</h3><div class="kv"><span>Contract value</span><b>${eth(
      contractValue,
    )}</b></div><div class="kv"><span>Released to Carrier</span><b>${eth(
      releasedAmount,
    )}</b></div>${refundRow}<div class="kv"><span>Remaining in Escrow</span><b>${eth(
      remaining,
    )}</b></div><p><small>Milestone payouts already sent to the carrier cannot be recalled. Expiry returns every wei still held by this agreement.</small></p></div></div>`;
    $("#view").innerHTML = html;
    headings("AGREEMENT DETAILS", `LG-${String(a.id).padStart(4, "0")}`);
    rememberView("details", Number(id));
    navActive("agreements");
  } catch (error) {
    console.error("Agreement detail rendering failed:", error);
    toast(`Unable to display agreement: ${parseError(error)}`, true);
  }
};
window.recreateAgreement = function (id) {
  const x = state.agreements.find((item) => Number(item.a.id) === Number(id));
  if (!x || state.role !== 1) {
    toast("Only the Shipper can recreate this agreement.", true);
    return;
  }
  rememberView("create");
  navActive("create");
  createView(x.a);
  toast(
    "Agreement information copied. Review it and choose a valid deadline before creating.",
  );
};
// Carrier evidence is stored first. Shipper confirmation releases the payout;
// Final confirmation  awards the Carrier reputation points.
window.submitEvidence = async function (id) {
  const input = $("#evidenceRef"),
    reference = input.value.trim();
  if (reference.length < 3 || reference.length > 200) {
    toast("Evidence reference must contain 3–200 characters.", true);
    input.focus();
    return;
  }
  if (
    !(await confirmReview(
      "Submit milestone evidence?",
      [
        ["Agreement", `LG-${String(id).padStart(4, "0")}`],
        ["Evidence reference", reference],
        ["Next step", "Shipper review required"],
      ],
      "Submit evidence",
    ))
  )
    return;
  try {
    const tx = await state.contract.submitMilestoneEvidence(id, reference);
    toast("Evidence submission sent…");
    await tx.wait();
    await refresh();
    details(id);
    toast("Evidence submitted for shipper review.");
  } catch (e) {
    toast(parseError(e), true);
  }
};
window.act = async function (type, id, value) {
  const x = state.agreements.find((x) => Number(x.a.id) === Number(id)),
    a = x.a,
    index = Number(a.completedMilestones),
    labels = {
      accept: "Accept agreement",
      fund: "Fund escrow",
      confirmMilestone: "Confirm milestone",
      cancel: "Cancel acceptance",
      settle: "Settle expired agreement",
    };
  const rows = [["Agreement", `LG-${String(id).padStart(4, "0")}`]];
  if (type === "fund") rows.push(["Amount", eth(a.contractValue)]);
  if (type === "confirmMilestone")
    rows.push(
      ["Milestone", x.m[index]?.description || "Next milestone"],
      ["Evidence", x.m[index]?.evidenceReference || "—"],
      ["Immediate payout", `${Number(x.m[index]?.payoutBps || 0) / 100}%`],
    );
  if (type === "cancel") rows.push(["Result", "Agreement will be cancelled"]);
  if (type === "settle")
    rows.push(["Refund to shipper", eth(a.contractValue - a.releasedAmount)]);
  if (!(await confirmReview(`${labels[type]}?`, rows, labels[type]))) return;
  try {
    let tx;
    if (type === "accept") tx = await state.contract.acceptAgreement(id);
    if (type === "fund")
      tx = await state.contract.fundAgreement(id, { value: BigInt(value) });
    if (type === "confirmMilestone")
      tx = await state.contract.confirmNextMilestone(id);
    if (type === "cancel")
      tx = await state.contract.cancelUnfundedAgreement(id);
    if (type === "settle") tx = await state.contract.settleExpiredAgreement(id);
    toast("Transaction submitted…");
    await tx.wait();
    await refresh();
    details(id);
    toast("Transaction confirmed.");
  } catch (e) {
    toast(parseError(e), true);
  }
};
// TRANSACTION HISTORY FROM CONTRACT EVENTS
// Events form the audit trail. Users can view current-wallet events or every event emitted by this deployed CarGrow contract
async function historyView() {
  headings("ON-CHAIN ACTIVITY", "Transaction History");
  try {
    const events = await state.contract.queryFilter("*", 0, "latest"),
      myIds = new Set(state.agreements.filter(mine).map((x) => Number(x.a.id)));
    const blocks = await Promise.all(
      events.map((e) => state.provider.getBlock(e.blockNumber)),
    );
    state.allHistoryEvents = events.map((event, i) => {
      const values = event.args?.toArray?.() || [];
      return {
        event,
        block: blocks[i],
        mine:
          values.some(
            (v) =>
              typeof v === "string" &&
              v.toLowerCase() === state.account.toLowerCase(),
          ) || myIds.has(Number(values[0])),
      };
    });
    renderHistory();
  } catch (e) {
    toast(parseError(e), true);
  }
}
function renderHistory() {
  const source =
    state.historyView.scope === "all"
      ? state.allHistoryEvents
      : state.allHistoryEvents.filter((x) => x.mine);
  state.historyEvents = [...source].sort((a, b) =>
    state.historyView.direction === "asc"
      ? Number(a.block.timestamp) - Number(b.block.timestamp)
      : Number(b.block.timestamp) - Number(a.block.timestamp),
  );
  const scopeLabel =
    state.historyView.scope === "all"
      ? "All blockchain transactions"
      : "Current account only";
  $(
    "#view",
  ).innerHTML = `<p class="form-intro">These events reconstruct contract participation and chronological milestone/payment activity. Current escrow balances remain visible inside Agreement Details.</p><div class="section-head"><h3>${
    state.historyEvents.length
  } transaction${
    state.historyEvents.length === 1 ? "" : "s"
  }</h3><button class="ghost filter-only" onclick="openHistoryFilter()" aria-label="Filter transaction history" title="Filter transaction history"><span class="filter-icon" aria-hidden="true"></span></button></div><div class="list-columns history-columns"><span>Date / Block</span><span>Event / Hash</span><span>Agreement ID</span><span>Status</span><span>Action</span></div><div class="agreement-list">${
    state.historyEvents.length
      ? state.historyEvents
          .map((record, i) => {
            const e = record.event,
              id = typeof e.args?.[0] === "bigint" ? e.args[0] : "—",
              eventName = e.fragment?.name || "Contract event";
            return `<div class="card agreement-row history-row"><b class="history-date"><span>${new Date(
              Number(record.block.timestamp) * 1000,
            ).toLocaleDateString()}</span><small>Block #${
              e.blockNumber
            }</small></b><div class="transaction-event" title="${escapeHtml(
              eventName,
            )}"><span class="event-name">${escapeHtml(
              eventName,
            )}</span><small>${short(
              e.transactionHash,
            )}</small></div><span class="history-agreement">${
              id === "—" ? "Account event" : `LG-${id}`
            }</span><span class="badge">Success</span><button class="ghost" onclick="showHistoryEvent(${i})">View</button></div>`;
          })
          .join("")
      : '<div class="card empty">No transactions match the selected scope.</div>'
  }</div>`;
}
window.openHistoryFilter = function () {
  const d = $("#historyFilterDialog");
  $("#historyScope").value = state.historyView.scope;
  $("#historyDirection").value = state.historyView.direction;
  d.showModal();
};
$("#historyFilterCancel").onclick = () => $("#historyFilterDialog").close();
$("#historyFilterApply").onclick = () => {
  state.historyView = {
    scope: $("#historyScope").value,
    direction: $("#historyDirection").value,
  };
  $("#historyFilterDialog").close();
  renderHistory();
};
window.showHistoryEvent = function (index) {
  const { event: e, block } = state.historyEvents[index],
    inputs = e.fragment?.inputs || [];
  const rows = [
    ["Event", e.fragment?.name || "Contract event"],
    ["Date / time", new Date(Number(block.timestamp) * 1000).toLocaleString()],
    ["Block", String(e.blockNumber)],
    ["Transaction hash", e.transactionHash],
  ];
  inputs.forEach((input, i) => {
    let value = e.args[i];
    if (typeof value === "bigint") {
      const isAmount = ["value", "amount", "payout"].includes(input.name);
      value = isAmount ? eth(value) : value.toString();
    }
    rows.push([input.name || `Value ${i + 1}`, String(value)]);
  });
  $("#infoTitle").textContent = "Transaction details";
  $("#infoBody").innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="confirm-line"><span>${escapeHtml(
          label,
        )}</span><b>${escapeHtml(value)}</b></div>`,
    )
    .join("");
  $("#infoDialog").showModal();
};
$("#infoClose").onclick = () => $("#infoDialog").close();

// REFRESH AND APPLICATION EVENT BINDINGS
// Refresh reloads blockchain data while preserving the current page/detail.
async function refresh() {
  await loadAgreements();
}
async function refreshCurrentView() {
  await refresh();
  if (state.currentView === "details" && state.currentDetailId)
    details(state.currentDetailId);
  else if (state.currentView === "agreements")
    listAgreements(
      state.agreements.filter(mine),
      "MY CONTRACTS",
      "My Agreements",
    );
  else if (state.currentView === "available")
    listAgreements(
      state.agreements.filter((x) => Number(x.a.status) === 0),
      "MARKETPLACE",
      "Available Agreements",
    );
  else if (state.currentView === "history") await historyView();
  else if (state.currentView === "create") createView();
  else dashboard();
}
document.querySelectorAll(".role-option").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".role-option")
        .forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
      state.selectedRole = Number(b.dataset.role);
      $("#registerBtn").disabled = false;
    }),
);
$("#connectBtn").onclick = connect;
$("#registerBtn").onclick = register;
$("#refreshBtn").onclick = async () => {
  await refreshCurrentView();
  toast("Current page refreshed with on-chain data.");
};
$("#disconnectBtn").onclick = () => location.reload();
if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => location.reload());
  window.ethereum.on("chainChanged", () => location.reload());
}
