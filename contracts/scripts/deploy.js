const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying MineSomnia contract to Somnia Network...");

  // Get the signer
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("📝 Deploying contracts with the account:", deployer.address);
  console.log("💰 Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // Deploy the MinesGame contract
  const MinesGame = await hre.ethers.getContractFactory("MinesGame");
  const minesGame = await MinesGame.deploy();
  
  await minesGame.waitForDeployment();

  console.log("✅ MineSomnia contract deployed to:", await minesGame.getAddress());
  console.log("📋 Contract ABI and address saved to artifacts/");

  // Add some initial funds to the house (optional)
  const initialFunds = hre.ethers.parseEther("1.0"); // 1 STT
  await minesGame.addHouseFunds({ value: initialFunds });
  console.log("💰 Added", hre.ethers.formatEther(initialFunds), "STT to house funds");

  // Verify the deployment
  const sharedPoolBalance = await minesGame.getSharedPoolBalance();
  console.log("🏦 House balance:", hre.ethers.formatEther(sharedPoolBalance), "STT");

  console.log("\n🎉 Deployment completed successfully!");
  console.log("📝 Contract Address:", await minesGame.getAddress());
  console.log("🔗 Network: Somnia Network");
  
  // Save deployment info
  const deploymentInfo = {
    contractAddress: await minesGame.getAddress(),
    network: "Somnia Network",
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };
  
  console.log("\n📄 Deployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Instructions for frontend integration
  console.log("\n🔧 Next Steps:");
  console.log("1. Copy the contract address above");
  console.log("2. Update src/config.js with the contract address");
  console.log("3. Test the frontend connection");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }); 