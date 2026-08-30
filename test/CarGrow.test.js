const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CarGrow expiry, verification, and carrier controls", function () {
  async function setup() {
    const [shipper, carrier, keeper] = await ethers.getSigners();
    const contract = await ethers.deployContract("CarGrow");
    await contract.waitForDeployment();
    await contract.connect(shipper).registerUser(1);
    await contract.connect(carrier).registerUser(2);
    return { contract, shipper, carrier, keeper };
  }

  it("lets a carrier cancel an accepted agreement before funding", async function () {
    const { contract, shipper, carrier } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await contract
      .connect(shipper)
      .createAgreement("Cargo", "A", "B", ethers.parseEther("1"), now + 3600);
    await contract.connect(carrier).acceptAgreement(1);
    await expect(contract.connect(carrier).cancelUnfundedAgreement(1)).to.emit(
      contract,
      "AgreementCancelled",
    );
  });

  it("blocks late milestones and allows anyone to settle remaining escrow", async function () {
    const { contract, shipper, carrier, keeper } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await contract
      .connect(shipper)
      .createAgreement("Cargo", "A", "B", ethers.parseEther("1"), now + 3600);
    await contract.connect(carrier).acceptAgreement(1);
    await contract
      .connect(shipper)
      .fundAgreement(1, { value: ethers.parseEther("1") });
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 3601]);
    await ethers.provider.send("evm_mine");
    await expect(
      contract.connect(carrier).submitMilestoneEvidence(1, "TRACK-001"),
    ).to.be.revertedWith("Deadline passed");
    await expect(contract.connect(keeper).settleExpiredAgreement(1))
      .to.emit(contract, "RefundClaimed")
      .withArgs(1, ethers.parseEther("1"));
    const [agreement] = await contract.getAgreement(1);
    expect(agreement.status).to.equal(5);
  });

  it("requires carrier evidence and shipper confirmation before payout", async function () {
    const { contract, shipper, carrier } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await contract
      .connect(shipper)
      .createAgreement("Cargo", "A", "B", ethers.parseEther("1"), now + 3600);
    await contract.connect(carrier).acceptAgreement(1);
    await contract
      .connect(shipper)
      .fundAgreement(1, { value: ethers.parseEther("1") });
    await expect(
      contract.connect(shipper).confirmNextMilestone(1),
    ).to.be.revertedWith("Evidence not submitted");
    await expect(
      contract.connect(carrier).submitMilestoneEvidence(1, "ipfs://proof-cid"),
    ).to.emit(contract, "MilestoneEvidenceSubmitted");
    await expect(contract.connect(shipper).confirmNextMilestone(1))
      .to.emit(contract, "MilestoneCompleted")
      .withArgs(1, 0, ethers.parseEther("0.3"));
    const [agreement, milestones] = await contract.getAgreement(1);
    expect(agreement.releasedAmount).to.equal(ethers.parseEther("0.3"));
    expect(milestones[0].completed).to.equal(true);
    expect(await contract.reputationPoints(carrier.address)).to.equal(0);
  });

  it("awards ten non-transferable reputation points only after final completion", async function () {
    const { contract, shipper, carrier } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await contract
      .connect(shipper)
      .createAgreement("Cargo", "A", "B", ethers.parseEther("1"), now + 3600);
    await contract.connect(carrier).acceptAgreement(1);
    await contract
      .connect(shipper)
      .fundAgreement(1, { value: ethers.parseEther("1") });
    for (let i = 0; i < 3; i++) {
      await contract.connect(carrier).submitMilestoneEvidence(1, `proof-${i}`);
      await contract.connect(shipper).confirmNextMilestone(1);
    }
    expect(await contract.reputationPoints(carrier.address)).to.equal(10);
    const [agreement] = await contract.getAgreement(1);
    expect(agreement.status).to.equal(3);
  });
});
