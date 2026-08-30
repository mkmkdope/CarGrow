async function main() {
  const CarGrow = await ethers.getContractFactory("CarGrow");
  const contract = await CarGrow.deploy();
  await contract.waitForDeployment();
  console.log("CarGrow deployed to:", await contract.getAddress());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
