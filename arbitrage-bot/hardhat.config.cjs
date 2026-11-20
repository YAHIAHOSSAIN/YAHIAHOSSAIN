require('@nomicfoundation/hardhat-ethers');
require('dotenv').config();

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 1000 }, viaIR: true } },
  networks: {
    mainnet: {
      url: process.env.RPC_URL || '',
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
