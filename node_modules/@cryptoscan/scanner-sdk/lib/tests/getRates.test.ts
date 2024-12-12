import { describe, expect, test } from 'vitest';
import { getRates } from '../index.js';

describe('get rates', () => {
	test('should get rates by symbols', async () => {
		const network = 'solana';
		const from = 'usdc';
		const to = 'sol';
		const rates = await getRates({
			network,
			from,
			to,
		})
		console.log(rates)
		expect(rates.length).toBeGreaterThan(0);
	}, 10_000)

	test('should get rates by addresses', async () => {
		const network = 'solana';
		const from = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
		const to = 'So11111111111111111111111111111111111111112';
		const rates = await getRates({
			network,
			from,
			to,
		})
		console.log(rates)
		expect(rates.length).toBeGreaterThan(0);
	}, 10_000)
})
