// @ts-nocheck
import { Router, Request, Response } from 'express';
import Token from '../models/Token';
import { createToken2, createMetadata } from '../services/createToken';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import Wallet from '../models/Wallets';
import base58 from 'bs58';
import PumpFunTrader from '@degenfrends/solana-pumpfun-trader';
import { buyTokens, sellTokens, buyTokens2, sellTokens2, buyTokensMultiple, fundWallets, withdrawFunds, sellTokensMultiple, buyTokensMultipleForCreate } from '../services/token';
import axios from 'axios';
import bs58 from 'bs58';
import * as jito from 'jito-ts';
import {sendBundlesForCreate } from '../services/jitoUtils';


const router = Router();

// Route to create a new token
router.post('/create', async (req: Request, res: Response) => {
    const { contractAddress, wallets } = req.body;
    const token = await Token.findOne({ contractAddress });
    if(!token) {
        return res.status(404).json({ message: 'Token not found' });
    }

    const { mintSecretKey, deployerSecretKey, metadataUri, name, symbol, initialBuyAmount } = token;
    const devWallet = Keypair.fromSecretKey(bs58.decode(deployerSecretKey));
    
    // Add dev wallet as the first wallet
    const orderedWallets = [
        {
            address: devWallet.publicKey.toBase58(),
            privateKey: base58.encode(devWallet.secretKey),
            amount: initialBuyAmount
        },
        ...wallets
    ];

    try {
        // Get Jito tip account first
        const blockEngineUrl = "frankfurt.mainnet.block-engine.jito.wtf";
        const jitoClient = jito.searcher.searcherClient(blockEngineUrl);
        const JITO_TIP_ACCOUNT = new PublicKey((await jitoClient.getTipAccounts())[0]);

        // Create Jito tip instruction
        const jitoTipInstruction = SystemProgram.transfer({
            fromPubkey: devWallet.publicKey,
            toPubkey: JITO_TIP_ACCOUNT,
            lamports: 0.001 * LAMPORTS_PER_SOL
        });

        // Get the create token transaction
        const createTokenIx = await createToken2(
            mintSecretKey, 
            deployerSecretKey, 
            metadataUri, 
            name, 
            symbol, 
            initialBuyAmount
        );

        // Get buy instructions
        const [buyIxs, walletsData] = await buyTokensMultipleForCreate(orderedWallets, contractAddress, initialBuyAmount);

        const con2 = new Connection("https://mainnet.helius-rpc.com/?api-key=f0c11eb0-ccc8-4f5f-afb3-b11308f4e46e");
        const {blockhash} = await con2.getLatestBlockhash('confirmed');

        // Flatten and combine all instructions
        const allInstructions = [jitoTipInstruction, createTokenIx.instruction, ...buyIxs].filter(ix => 
            ix && ix.programId && ix.keys && ix.data
        );
        
        console.log(`Total instructions after flattening: ${allInstructions.length}`);
        
        // Debug log each instruction
        allInstructions.forEach((ix, index) => {
            console.log(`Instruction ${index}:`, {
                programId: ix.programId.toBase58(),
                keysLength: ix.keys.length,
                dataLength: ix.data.length
            });
        });

        const signerKeypair = Keypair.fromSecretKey(bs58.decode(deployerSecretKey));
        const mintKeypair = Keypair.fromSecretKey(bs58.decode(mintSecretKey));

        // Create transactions based on size limit
        const transactions: VersionedTransaction[] = [];
        let currentInstructions: TransactionInstruction[] = [];
        let transactionCount = 0;
        let jitoTipAdded = false;
        
        for (const ix of allInstructions) {
            const tempInstructions = [...currentInstructions, ix];
            
            try {
                // Test transaction size
                const testMessage = new TransactionMessage({
                    payerKey: signerKeypair.publicKey,
                    recentBlockhash: blockhash,
                    instructions: tempInstructions
                }).compileToV0Message();
                
                const testTx = new VersionedTransaction(testMessage);
                const txSize = testTx.serialize().length;
                
                if (txSize > 1200) {
                    // Create transaction with current instructions
                    if (currentInstructions.length > 0) {
                        transactionCount++;
                        console.log(`\n=== Transaction #${transactionCount} Details ===`);
                        console.log(`Number of instructions: ${currentInstructions.length}`);
                        
                        // Get all unique wallet addresses involved in this transaction
                        const walletAddresses = new Set<string>();
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

                        const tx = new VersionedTransaction(
                            new TransactionMessage({
                                payerKey: signerKeypair.publicKey,
                                recentBlockhash: blockhash,
                                instructions: currentInstructions
                            }).compileToV0Message()
                        );
                        
                        // Signing logic remains the same
                        const signers = [signerKeypair];
                        if (hasCreateInstruction) {
                            signers.push(mintKeypair);
                        }

                        const relevantWallets = wallets.filter(wallet => 
                            walletAddresses.has(wallet.address)
                        );

                        for (const wallet of relevantWallets) {
                            signers.push(Keypair.fromSecretKey(bs58.decode(wallet.privateKey)));
                        }
                        
                        tx.sign(signers);
                        console.log(`\nTransaction details:`);
                        console.log(`- Size: ${tx.serialize().length} bytes`);
                        console.log(`- Number of signers: ${signers.length}`);
                        console.log('=====================================\n');
                        
                        transactions.push(tx);
                    }
                    currentInstructions = [ix];
                } else {
                    currentInstructions = tempInstructions;
                }
            } catch (err) {
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
            const walletAddresses = new Set<string>();
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
            if (hasJitoTip) console.log(`- Jito tip instruction: 1`);
            console.log(`- Create instructions: ${hasCreateInstruction ? 1 : 0}`);
            console.log(`- Buy instructions: ${currentInstructions.length - (hasCreateInstruction ? 1 : 0) - (hasJitoTip ? 1 : 0) - 1}`);

            const tx = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: signerKeypair.publicKey,
                    recentBlockhash: blockhash,
                    instructions: currentInstructions
                }).compileToV0Message()
            );
            
            const signers = [signerKeypair];
            if (hasCreateInstruction) {
                signers.push(mintKeypair);
            }

            const relevantWallets = wallets.filter(wallet => 
                walletAddresses.has(wallet.address)
            );

            for (const wallet of relevantWallets) {
                signers.push(Keypair.fromSecretKey(bs58.decode(wallet.privateKey)));
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

      

        await sendBundlesForCreate(5, signerKeypair, transactions);
        
        // If we get here, either we got success or timed out without error - both are good
        res.status(200).json({
            message: 'Token created successfully',
            transactionCount: transactions.length,
            totalInstructions: allInstructions.length
        });

    } catch (error) {
        // Only reaches here on explicit errors
        console.error('Error creating token:', error);
        res.status(500).json({ 
            message: 'Error creating token', 
            error: error.message,
            stack: error.stack 
        });
    }
});


router.post('/create-metadata', async (req: Request, res: Response) => {
  console.log(req.body);
  const { name, symbol, description, logo, telegramUrl, websiteUrl, twitterUrl, secretKey, projectId, metadataUri, initialBuyAmount } = req.body;
  const signerKeyPair = Keypair.fromSecretKey(bs58.decode(secretKey));

  try {
    const { mintKeypair } = await createMetadata({
      name,
      symbol,
      description,
      twitter: twitterUrl,
      telegram: telegramUrl,
      website: websiteUrl
    });

    console.log(mintKeypair);

    const contractAddress = mintKeypair.publicKey.toBase58();

    const newToken = new Token({ 
      name, 
      symbol, 
      logo, 
      telegramUrl, 
      websiteUrl, 
      twitterUrl, 
      owner: signerKeyPair.publicKey.toBase58(), 
      contractAddress: contractAddress,
      mintSecretKey: bs58.encode(mintKeypair.secretKey),
      deployerSecretKey: secretKey,
      metadataUri,
      projectId,
      initialBuyAmount
    });
    const savedToken = await newToken.save();

    console.log('Token saved:', savedToken);
    res.status(201).json({ message: 'Token metadata created successfully', token: savedToken });
  } catch (error) {
    console.error('Error creating token:', error);
    res.status(500).json({ message: 'Error creating token', error });
  }
});

router.get('/get-token/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  
  if (!projectId) {
    return res.status(400).json({ message: 'Project ID is required' });
  }

  try {
    const token = await Token.findOne({ projectId });
    res.status(200).json({ token });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({ message: 'Error fetching tokens', error });
  }
});

router.get('/get-wallets/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const wallets = await Wallet.find({ projectId });
  console.log(wallets);
  res.status(200).json({ wallets });
});

router.post('/generate-wallet', async (req: Request, res: Response) => {
  const { numberOfWallets, ownerAddress, projectId } = req.body;
  console.log(numberOfWallets, ownerAddress, projectId);
  if (!numberOfWallets || !ownerAddress || !projectId) {
    return res.status(400).json({ message: 'Number of wallets, owner address and project ID are required' });
  }

  try {
    const generatedWallets = Array.from({ length: numberOfWallets }, () => {
      const keypair = Keypair.generate();
      
      return {
        ownerAddress,
        publicKey: keypair.publicKey.toString(),
        secretKey: base58.encode(keypair.secretKey),
        projectId
      };
    });

    const savedWallets = await Wallet.insertMany(generatedWallets);
    
    res.status(201).json({ 
      message: 'Wallets generated and saved successfully',
      ownerAddress,
      wallets: savedWallets,
      count: savedWallets.length
    });
  } catch (error) {
    console.error('Error generating wallets:', error);
    res.status(500).json({ message: 'Error generating wallets', error });
  }
});


router.post('/fund-wallets', async (req: Request, res: Response) => {
  const { wallets, privateKey } = req.body;
  console.log(wallets, privateKey);

  try {
    await fundWallets(wallets, privateKey);
    res.status(200).json({ message: 'Wallets funded successfully' });
  } catch (error) {
    console.error('Error funding wallets:', error);
    res.status(500).json({ message: 'Error funding wallets', error: error.message });
  }
});

router.post('/withdraw', async (req: Request, res: Response) => {
  const { wallets, fundingWallet } = req.body;
  console.log(wallets);
  console.log(fundingWallet);
  if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
    return res.status(400).json({ message: 'Wallets array is required and cannot be empty' });
  }

  try {
    // Get wallet details from database in a single query
    const walletAddresses = wallets.map(w => w.address);
    const walletDetails = await Wallet.find({ publicKey: { $in: walletAddresses } });

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

    await withdrawFunds(walletsWithKeys, fundingWallet);
    res.status(200).json({ message: 'Withdrawals executed successfully' });
  } catch (error) {
    console.error('Error executing withdrawals:', error);
    res.status(500).json({ 
      message: 'Error executing withdrawals', 
      error: error.message 
    });
  }
});


router.post('/buy', async (req: Request, res: Response) => {
    const { wallets, tokenAddress } = req.body;
    console.log('Buy request received for:', { wallets, tokenAddress });  // Add debug log
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
        const walletDetails = await Wallet.find({ publicKey: { $in: walletAddresses } });

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
        await buyTokensMultiple(walletsWithKeys, tokenAddress);

        res.status(200).json({ 
            message: 'Buy orders executed successfully',
            walletCount: walletsWithKeys.length
        });

    } catch (error) {
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
});


router.post('/sell', async (req: Request, res: Response) => {
  const { wallets, tokenAddress } = req.body;
  console.log('Sell request received for wallets:', wallets);
  
  if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
    return res.status(400).json({ message: 'Wallets array is required and cannot be empty' });
  }

  try {
    // Get wallet details from database in a single query
    const walletAddresses = wallets.map(w => w.address);
    const walletDetails = await Wallet.find({ publicKey: { $in: walletAddresses } });

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
    const transactions = await sellTokensMultiple(walletsWithKeys, tokenAddress);

    res.status(200).json({ 
      message: 'Sell orders executed successfully',
      transactionCount: transactions.length
    });

  } catch (error) {
    console.error('Error executing sell orders:', error);
    res.status(500).json({ 
      message: 'Error executing sell orders', 
      error: error.message 
    });
  }
});


router.post('/get-wallets', async (req: Request, res: Response) => {
  const { addresses } = req.body;

  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ message: 'Wallet addresses array is required' });
  }

  try {
    const wallets = await Wallet.find({ publicKey: { $in: addresses } });
    console.log(wallets);
    res.status(200).json({ wallets });
  } catch (error) {
    console.error('Error fetching wallets:', error);
    res.status(500).json({ 
      message: 'Error fetching wallets',
      error: error.message 
    });
  }
});





export default router;
