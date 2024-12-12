"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const express_1 = require("express");
const Token_1 = __importDefault(require("../models/Token"));
const createToken_1 = require("../services/createToken");
const web3_js_1 = require("@solana/web3.js");
const Wallets_1 = __importDefault(require("../models/Wallets"));
const bs58_1 = __importDefault(require("bs58"));
const token_1 = require("../services/token");
const bs58_2 = __importDefault(require("bs58"));
const jito = __importStar(require("jito-ts"));
const jitoUtils_1 = require("../services/jitoUtils");
const router = (0, express_1.Router)();
// Route to create a new token
router.post('/create', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { contractAddress, wallets } = req.body;
    const token = yield Token_1.default.findOne({ contractAddress });
    if (!token) {
        return res.status(404).json({ message: 'Token not found' });
    }
    const { mintSecretKey, deployerSecretKey, metadataUri, name, symbol, initialBuyAmount } = token;
    const devWallet = web3_js_1.Keypair.fromSecretKey(bs58_2.default.decode(deployerSecretKey));
    // Add dev wallet as the first wallet
    const orderedWallets = [
        {
            address: devWallet.publicKey.toBase58(),
            privateKey: bs58_1.default.encode(devWallet.secretKey),
            amount: initialBuyAmount
        },
        ...wallets
    ];
    try {
        // Get Jito tip account first
        const blockEngineUrl = "frankfurt.mainnet.block-engine.jito.wtf";
        const jitoClient = jito.searcher.searcherClient(blockEngineUrl);
        const JITO_TIP_ACCOUNT = new web3_js_1.PublicKey((yield jitoClient.getTipAccounts())[0]);
        // Create Jito tip instruction
        const jitoTipInstruction = web3_js_1.SystemProgram.transfer({
            fromPubkey: devWallet.publicKey,
            toPubkey: JITO_TIP_ACCOUNT,
            lamports: 0.001 * web3_js_1.LAMPORTS_PER_SOL
        });
        // Get the create token transaction
        const createTokenIx = yield (0, createToken_1.createToken2)(mintSecretKey, deployerSecretKey, metadataUri, name, symbol, initialBuyAmount);
        // Get buy instructions
        const [buyIxs, walletsData] = yield (0, token_1.buyTokensMultipleForCreate)(orderedWallets, contractAddress, initialBuyAmount);
        const con2 = new web3_js_1.Connection("https://mainnet.helius-rpc.com/?api-key=f0c11eb0-ccc8-4f5f-afb3-b11308f4e46e");
        const { blockhash } = yield con2.getLatestBlockhash('confirmed');
        // Flatten and combine all instructions
        const allInstructions = [jitoTipInstruction, createTokenIx.instruction, ...buyIxs].filter(ix => ix && ix.programId && ix.keys && ix.data);
        console.log(`Total instructions after flattening: ${allInstructions.length}`);
        // Debug log each instruction
        allInstructions.forEach((ix, index) => {
            console.log(`Instruction ${index}:`, {
                programId: ix.programId.toBase58(),
                keysLength: ix.keys.length,
                dataLength: ix.data.length
            });
        });
        const signerKeypair = web3_js_1.Keypair.fromSecretKey(bs58_2.default.decode(deployerSecretKey));
        const mintKeypair = web3_js_1.Keypair.fromSecretKey(bs58_2.default.decode(mintSecretKey));
        // Create transactions based on size limit
        const transactions = [];
        let currentInstructions = [];
        let transactionCount = 0;
        let jitoTipAdded = false;
        for (const ix of allInstructions) {
            const tempInstructions = [...currentInstructions, ix];
            try {
                // Test transaction size
                const testMessage = new web3_js_1.TransactionMessage({
                    payerKey: signerKeypair.publicKey,
                    recentBlockhash: blockhash,
                    instructions: tempInstructions
                }).compileToV0Message();
                const testTx = new web3_js_1.VersionedTransaction(testMessage);
                const txSize = testTx.serialize().length;
                if (txSize > 1200) {
                    // Create transaction with current instructions
                    if (currentInstructions.length > 0) {
                        transactionCount++;
                        console.log(`\n=== Transaction #${transactionCount} Details ===`);
                        console.log(`Number of instructions: ${currentInstructions.length}`);
                        // Get all unique wallet addresses involved in this transaction
                        const walletAddresses = new Set();
                        currentInstructions.forEach(instruction => {
                            instruction.keys.forEach(key => {
                                if (key.isSigner &&
                                    key.pubkey.toBase58() !== signerKeypair.publicKey.toBase58() &&
                                    key.pubkey.toBase58() !== mintKeypair.publicKey.toBase58()) {
                                    walletAddresses.add(key.pubkey.toBase58());
                                }
                            });
                        });
                        console.log('\nWallets in this transaction:');
                        Array.from(walletAddresses).forEach((address, index) => {
                            console.log(`${index + 1}. ${address}`);
                        });
                        const hasCreateInstruction = currentInstructions.includes(createTokenIx.instruction);
                        const hasJitoTip = currentInstructions.includes(jitoTipInstruction);
                        console.log('\nInstruction breakdown:');
                        if (hasJitoTip) {
                            console.log(`- Jito tip instruction: 1`);
                            jitoTipAdded = true;
                        }
                        console.log(`- Create instructions: ${hasCreateInstruction ? 1 : 0}`);
                        console.log(`- Buy instructions: ${currentInstructions.length - (hasCreateInstruction ? 1 : 0) - (hasJitoTip ? 1 : 0)}`);
                        const tx = new web3_js_1.VersionedTransaction(new web3_js_1.TransactionMessage({
                            payerKey: signerKeypair.publicKey,
                            recentBlockhash: blockhash,
                            instructions: currentInstructions
                        }).compileToV0Message());
                        // Signing logic remains the same
                        const signers = [signerKeypair];
                        if (hasCreateInstruction) {
                            signers.push(mintKeypair);
                        }
                        const relevantWallets = wallets.filter(wallet => walletAddresses.has(wallet.address));
                        for (const wallet of relevantWallets) {
                            signers.push(web3_js_1.Keypair.fromSecretKey(bs58_2.default.decode(wallet.privateKey)));
                        }
                        tx.sign(signers);
                        console.log(`\nTransaction details:`);
                        console.log(`- Size: ${tx.serialize().length} bytes`);
                        console.log(`- Number of signers: ${signers.length}`);
                        console.log('=====================================\n');
                        transactions.push(tx);
                    }
                    currentInstructions = [ix];
                }
                else {
                    currentInstructions = tempInstructions;
                }
            }
            catch (err) {
                console.error('Error processing instruction:', err);
                throw err;
            }
        }
        // Process final transaction batch
        if (currentInstructions.length > 0) {
            transactionCount++;
            console.log(`\n=== Transaction #${transactionCount} Details ===`);
            console.log(`Number of instructions: ${currentInstructions.length}`);
            // Get all unique wallet addresses involved in this transaction
            const walletAddresses = new Set();
            currentInstructions.forEach(instruction => {
                instruction.keys.forEach(key => {
                    if (key.isSigner &&
                        key.pubkey.toBase58() !== signerKeypair.publicKey.toBase58() &&
                        key.pubkey.toBase58() !== mintKeypair.publicKey.toBase58()) {
                        walletAddresses.add(key.pubkey.toBase58());
                    }
                });
            });
            // Rest of the logging
            console.log('\nWallets in this transaction:');
            Array.from(walletAddresses).forEach((address, index) => {
                console.log(`${index + 1}. ${address}`);
            });
            const hasCreateInstruction = currentInstructions.includes(createTokenIx.instruction);
            const hasJitoTip = currentInstructions.includes(jitoTipInstruction);
            console.log('\nInstruction breakdown:');
            if (hasJitoTip)
                console.log(`- Jito tip instruction: 1`);
            console.log(`- Create instructions: ${hasCreateInstruction ? 1 : 0}`);
            console.log(`- Buy instructions: ${currentInstructions.length - (hasCreateInstruction ? 1 : 0) - (hasJitoTip ? 1 : 0) - 1}`);
            const tx = new web3_js_1.VersionedTransaction(new web3_js_1.TransactionMessage({
                payerKey: signerKeypair.publicKey,
                recentBlockhash: blockhash,
                instructions: currentInstructions
            }).compileToV0Message());
            const signers = [signerKeypair];
            if (hasCreateInstruction) {
                signers.push(mintKeypair);
            }
            const relevantWallets = wallets.filter(wallet => walletAddresses.has(wallet.address));
            for (const wallet of relevantWallets) {
                signers.push(web3_js_1.Keypair.fromSecretKey(bs58_2.default.decode(wallet.privateKey)));
            }
            tx.sign(signers);
            console.log(`\nTransaction details:`);
            console.log(`- Size: ${tx.serialize().length} bytes`);
            console.log(`- Number of signers: ${signers.length}`);
            if (hasJitoTip) {
                console.log(`- Includes Jito tip: 0.001 SOL`);
            }
            console.log('=====================================\n');
            transactions.push(tx);
        }
        console.log('\n=== Final Summary ===');
        console.log(`Total transactions created: ${transactions.length}`);
        console.log(`Total instructions processed: ${allInstructions.length}`);
        console.log('===================\n');
        yield (0, jitoUtils_1.sendBundlesForCreate)(5, signerKeypair, transactions);
        // If we get here, either we got success or timed out without error - both are good
        res.status(200).json({
            message: 'Token created successfully',
            transactionCount: transactions.length,
            totalInstructions: allInstructions.length
        });
    }
    catch (error) {
        // Only reaches here on explicit errors
        console.error('Error creating token:', error);
        res.status(500).json({
            message: 'Error creating token',
            error: error.message,
            stack: error.stack
        });
    }
}));
router.post('/create-metadata', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(req.body);
    const { name, symbol, description, logo, telegramUrl, websiteUrl, twitterUrl, secretKey, projectId, metadataUri, initialBuyAmount } = req.body;
    const signerKeyPair = web3_js_1.Keypair.fromSecretKey(bs58_2.default.decode(secretKey));
    try {
        const { mintKeypair } = yield (0, createToken_1.createMetadata)({
            name,
            symbol,
            description,
            twitter: twitterUrl,
            telegram: telegramUrl,
            website: websiteUrl
        });
        console.log(mintKeypair);
        const contractAddress = mintKeypair.publicKey.toBase58();
        const newToken = new Token_1.default({
            name,
            symbol,
            logo,
            telegramUrl,
            websiteUrl,
            twitterUrl,
            owner: signerKeyPair.publicKey.toBase58(),
            contractAddress: contractAddress,
            mintSecretKey: bs58_2.default.encode(mintKeypair.secretKey),
            deployerSecretKey: secretKey,
            metadataUri,
            projectId,
            initialBuyAmount
        });
        const savedToken = yield newToken.save();
        console.log('Token saved:', savedToken);
        res.status(201).json({ message: 'Token metadata created successfully', token: savedToken });
    }
    catch (error) {
        console.error('Error creating token:', error);
        res.status(500).json({ message: 'Error creating token', error });
    }
}));
router.get('/get-token/:projectId', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { projectId } = req.params;
    if (!projectId) {
        return res.status(400).json({ message: 'Project ID is required' });
    }
    try {
        const token = yield Token_1.default.findOne({ projectId });
        res.status(200).json({ token });
    }
    catch (error) {
        console.error('Error fetching tokens:', error);
        res.status(500).json({ message: 'Error fetching tokens', error });
    }
}));
router.get('/get-wallets/:projectId', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { projectId } = req.params;
    const wallets = yield Wallets_1.default.find({ projectId });
    console.log(wallets);
    res.status(200).json({ wallets });
}));
router.post('/generate-wallet', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { numberOfWallets, ownerAddress, projectId } = req.body;
    console.log(numberOfWallets, ownerAddress, projectId);
    if (!numberOfWallets || !ownerAddress || !projectId) {
        return res.status(400).json({ message: 'Number of wallets, owner address and project ID are required' });
    }
    try {
        const generatedWallets = Array.from({ length: numberOfWallets }, () => {
            const keypair = web3_js_1.Keypair.generate();
            return {
                ownerAddress,
                publicKey: keypair.publicKey.toString(),
                secretKey: bs58_1.default.encode(keypair.secretKey),
                projectId
            };
        });
        const savedWallets = yield Wallets_1.default.insertMany(generatedWallets);
        res.status(201).json({
            message: 'Wallets generated and saved successfully',
            ownerAddress,
            wallets: savedWallets,
            count: savedWallets.length
        });
    }
    catch (error) {
        console.error('Error generating wallets:', error);
        res.status(500).json({ message: 'Error generating wallets', error });
    }
}));
router.post('/fund-wallets', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { wallets, privateKey } = req.body;
    console.log(wallets, privateKey);
    try {
        yield (0, token_1.fundWallets)(wallets, privateKey);
        res.status(200).json({ message: 'Wallets funded successfully' });
    }
    catch (error) {
        console.error('Error funding wallets:', error);
        res.status(500).json({ message: 'Error funding wallets', error: error.message });
    }
}));
router.post('/withdraw', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { wallets, fundingWallet } = req.body;
    console.log(wallets);
    console.log(fundingWallet);
    if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
        return res.status(400).json({ message: 'Wallets array is required and cannot be empty' });
    }
    try {
        // Get wallet details from database in a single query
        const walletAddresses = wallets.map(w => w.address);
        const walletDetails = yield Wallets_1.default.find({ publicKey: { $in: walletAddresses } });
        // Create lookup map for faster access
        const walletMap = new Map(walletDetails.map(w => [w.publicKey, w]));
        // Build wallet array with private keys
        const walletsWithKeys = wallets.map(wallet => {
            const details = walletMap.get(wallet.address);
            if (!details) {
                throw new Error(`Wallet not found for address: ${wallet.address}`);
            }
            return {
                address: wallet.address,
                privateKey: details.secretKey
            };
        });
        console.log(walletsWithKeys);
        yield (0, token_1.withdrawFunds)(walletsWithKeys, fundingWallet);
        res.status(200).json({ message: 'Withdrawals executed successfully' });
    }
    catch (error) {
        console.error('Error executing withdrawals:', error);
        res.status(500).json({
            message: 'Error executing withdrawals',
            error: error.message
        });
    }
}));
router.post('/buy', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { wallets, tokenAddress } = req.body;
    console.log('Buy request received for:', { wallets, tokenAddress }); // Add debug log
    console.log(tokenAddress, "asdasd");
    if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
        return res.status(400).json({ message: 'Wallets array is required and cannot be empty' });
    }
    if (!tokenAddress || typeof tokenAddress !== 'string') {
        return res.status(400).json({ message: 'Valid token address is required' });
    }
    try {
        // Get all wallet details in a single query
        const walletAddresses = wallets.map(w => w.address);
        const walletDetails = yield Wallets_1.default.find({ publicKey: { $in: walletAddresses } });
        // Create lookup map for faster access
        const walletMap = new Map(walletDetails.map(w => [w.publicKey, w]));
        // Build wallet array with private keys
        const walletsWithKeys = wallets.map(wallet => {
            const details = walletMap.get(wallet.address);
            if (!details) {
                throw new Error(`Wallet not found for address: ${wallet.address}`);
            }
            return {
                address: wallet.address,
                privateKey: details.secretKey,
                amount: Number(wallet.solAmount) // Ensure amount is a number
            };
        });
        // Pass all wallets and token address to buyTokensMultiple
        yield (0, token_1.buyTokensMultiple)(walletsWithKeys, tokenAddress);
        res.status(200).json({
            message: 'Buy orders executed successfully',
            walletCount: walletsWithKeys.length
        });
    }
    catch (error) {
        console.error('Error executing buy orders:', error);
        res.status(500).json({
            message: 'Error executing buy orders',
            error: error.message,
            details: {
                wallets: wallets.map(w => w.address),
                tokenAddress
            }
        });
    }
}));
router.post('/sell', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { wallets, tokenAddress } = req.body;
    console.log('Sell request received for wallets:', wallets);
    if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
        return res.status(400).json({ message: 'Wallets array is required and cannot be empty' });
    }
    try {
        // Get wallet details from database in a single query
        const walletAddresses = wallets.map(w => w.address);
        const walletDetails = yield Wallets_1.default.find({ publicKey: { $in: walletAddresses } });
        // Create lookup map for faster access
        const walletMap = new Map(walletDetails.map(w => [w.publicKey, w]));
        // Build wallet array with private keys and token amounts
        const walletsWithKeys = wallets.map(wallet => {
            const details = walletMap.get(wallet.address);
            if (!details) {
                throw new Error(`Wallet not found for address: ${wallet.address}`);
            }
            return {
                privateKey: details.secretKey.toString(),
                tokenAmount: wallet.tokenAmount // Include token amount from request
            };
        });
        // Build wallet array with private keys
        console.log(walletsWithKeys);
        // Call sellTokensMultiple with the prepared wallets
        const transactions = yield (0, token_1.sellTokensMultiple)(walletsWithKeys, tokenAddress);
        res.status(200).json({
            message: 'Sell orders executed successfully',
            transactionCount: transactions.length
        });
    }
    catch (error) {
        console.error('Error executing sell orders:', error);
        res.status(500).json({
            message: 'Error executing sell orders',
            error: error.message
        });
    }
}));
router.post('/get-wallets', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { addresses } = req.body;
    if (!addresses || !Array.isArray(addresses)) {
        return res.status(400).json({ message: 'Wallet addresses array is required' });
    }
    try {
        const wallets = yield Wallets_1.default.find({ publicKey: { $in: addresses } });
        console.log(wallets);
        res.status(200).json({ wallets });
    }
    catch (error) {
        console.error('Error fetching wallets:', error);
        res.status(500).json({
            message: 'Error fetching wallets',
            error: error.message
        });
    }
}));
exports.default = router;
