import WebSocket from 'ws';
import { Transaction } from './types/Transaction.js';
import { Rate } from "./types/Rate.js";

export interface GetRateParams {
	network: string;
	service?: string;
	to: string;
	from?: string;
	amount?: number;
}

export const getRates = async ({ network, to, from, amount }: GetRateParams): Promise<Rate[]> => {
	const params = new URLSearchParams()
	params.set('network', network);
	params.set('to', to);
	if (from) {
		params.set('from', from);
	}
	if (amount && (Number.isNaN(amount) || !Number.isFinite(amount))) {
		throw new Error('Amount must be a number')
	}
	if (amount) {
		params.set('amount', String(amount));
	}
	const res = await fetch('https://api.cryptoscan.pro/v1/rate?' + params.toString());
	return res.json();
}

export const getRate = (params: GetRateParams): Promise<Rate | undefined> => 
	getRates(params).then(r => Array.isArray(r) ? r[0] : r)

export const getPrice = (params: GetRateParams): Promise<number | undefined> => 
	getRate(params).then(r => r?.price)

export const listenTransactions = (
	params: Omit<GetRateParams, 'amount'>,
	onTransaction: (transaction: Transaction) => void,
): () => void => {
	const ws = new WebSocket('wss://api.cryptoscan.pro/v1/transactions');

	ws.on('open', () => {
		ws.send(JSON.stringify(params));
	})

	ws.on('message', (msg) => {
		const data = JSON.parse(msg.toString());
		onTransaction({
			...data,
			createdAt: new Date(data.createdDate),
		})
	})

	return () => {
		ws.close();
	}
}

export * from './types/index.js';
