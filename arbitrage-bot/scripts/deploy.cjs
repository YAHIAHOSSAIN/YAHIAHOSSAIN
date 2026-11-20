const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying from', deployer.address);
  const arb = await hre.ethers.deployContract('FlashArbitrage');
  await arb.waitForDeployment();
  console.log('FlashArbitrage deployed at', await arb.getAddress());
  console.log('Put this address in .env as ARB_CONTRACT');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
