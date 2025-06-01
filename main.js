const { ethers } = require('ethers');
const chalk = require('chalk');
const fs = require('fs').promises;
const prompt = require('prompt-sync')({ sigint: true });

// Fungsi untuk membaca file
const readFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data;
  } catch (err) {
    console.error(chalk.red(`Error membaca file ${filePath}: ${err.message}`));
    process.exit(1);
  }
};

// Fungsi untuk memvalidasi ABI
const validateAbi = (abi) => {
  try {
    return JSON.parse(abi);
  } catch (err) {
    console.error(chalk.red('Error: File abi.json tidak valid! Pastikan format JSON benar.'));
    process.exit(1);
  }
};

// Fungsi untuk mendeteksi fungsi mint dalam ABI
const findMintFunction = (abi) => {
  const mintFunctions = abi.filter(
    (item) =>
      item.type === 'function' &&
      item.stateMutability === 'payable' &&
      (item.name.toLowerCase().includes('mint') || item.name.toLowerCase().includes('claim'))
  );

  if (mintFunctions.length === 0) {
    console.error(chalk.red('Error: Tidak ada fungsi mint yang ditemukan di ABI!'));
    process.exit(1);
  }

  // Pilih fungsi mint pertama yang ditemukan
  return mintFunctions[0];
};

// Fungsi untuk mendeteksi fungsi max mint per wallet
const findMaxMintFunction = (abi) => {
  return abi.find(
    (item) =>
      item.type === 'function' &&
      item.stateMutability === 'view' &&
      item.name.toLowerCase().includes('maxmint') &&
      item.outputs.length > 0 &&
      item.outputs[0].type === 'uint256'
  );
};

// Fungsi utama
const main = async () => {
  console.log(chalk.cyan.bold('\n=== Bot Auto Mint NFT ApeChain ===\n'));

  // Minta input contract address
  const contractAddress = prompt(chalk.yellow('Masukkan alamat kontrak NFT: '));
  if (!ethers.utils.isAddress(contractAddress)) {
    console.error(chalk.red('Error: Alamat kontrak tidak valid!'));
    process.exit(1);
  }

  // Baca dan validasi file
  const rpcData = JSON.parse(await readFile('rpc.json'));
  const privateKeys = (await readFile('PrivateKeys.txt')).split('\n').filter((key) => key.trim());
  const abi = validateAbi(await readFile('abi.json'));

  // Inisialisasi provider
  const provider = new ethers.providers.JsonRpcProvider(rpcData.rpcUrl);
  console.log(chalk.green(`Terhubung ke ${rpcData.networkName} (Chain ID: ${rpcData.chainId})`));

  // Deteksi fungsi mint
  const mintFunction = findMintFunction(abi);
  console.log(chalk.blue(`Fungsi mint ditemukan: ${mintFunction.name}`));

  // Deteksi fungsi max mint (opsional)
  const maxMintFunction = findMaxMintFunction(abi);
  let maxMintPerWallet = 1; // Default jika tidak ada fungsi maxMint
  if (maxMintFunction) {
    console.log(chalk.blue(`Fungsi max mint ditemukan: ${maxMintFunction.name}`));
  }

  // Inisialisasi kontrak
  const contract = new ethers.Contract(contractAddress, abi, provider);

  // Loop melalui setiap private key
  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i].trim();
    if (!privateKey.startsWith('0x')) {
      console.log(chalk.yellow(`Wallet ${i + 1}: Private key tidak valid, dilewati.`));
      continue;
    }

    try {
      const wallet = new ethers.Wallet(privateKey, provider);
      const contractWithSigner = contract.connect(wallet);
      console.log(chalk.cyan(`\nMemproses wallet ${i + 1} (${wallet.address})`));

      // Cek max mint per wallet jika ada fungsi maxMint
      if (maxMintFunction) {
        try {
          maxMintPerWallet = await contractWithSigner[maxMintFunction.name]();
          maxMintPerWallet = parseInt(maxMintPerWallet.toString());
          console.log(chalk.green(`Max mint per wallet: ${maxMintPerWallet}`));
        } catch (err) {
          console.log(chalk.yellow(`Gagal mengambil max mint: ${err.message}`));
        }
      }

      // Tentukan jumlah mint (default 1, atau sesuai maxMintPerWallet)
      const mintQuantity = maxMintPerWallet > 1 ? maxMintPerWallet : 1;

      // Estimasi gas dan kirim transaksi mint
      console.log(chalk.blue(`Mencoba mint ${mintQuantity} NFT...`));
      const gasLimit = await contractWithSigner.estimateGas[mintFunction.name](mintQuantity, {
        value: ethers.utils.parseEther('0'), // Asumsi mint gratis, ubah jika ada biaya
      });

      const tx = await contractWithSigner[mintFunction.name](mintQuantity, {
        gasLimit: gasLimit.mul(120).div(100), // Tambah 20% buffer untuk gas
        value: ethers.utils.parseEther('0'), // Sesuaikan jika mint berbayar
      });

      console.log(chalk.green(`Transaksi dikirim! Tx Hash: ${tx.hash}`));
      console.log(chalk.blue(`Menunggu konfirmasi...`));

      // Tunggu konfirmasi transaksi
      const receipt = await tx.wait();
      console.log(chalk.green.bold(`Mint berhasil untuk wallet ${i + 1}!`));
      console.log(chalk.green(`Block: ${receipt.blockNumber} | Tx: ${rpcData.blockExplorer}tx/${tx.hash}`));

    } catch (err) {
      console.error(chalk.red(`Gagal mint untuk wallet ${i + 1}: ${err.message}`));
    }

    // Delay untuk menghindari rate limit
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(chalk.cyan.bold('\n=== Proses mint selesai! ===\n'));
};

// Jalankan bot
main().catch((err) => {
  console.error(chalk.red(`Error utama: ${err.message}`));
  process.exit(1);
});
