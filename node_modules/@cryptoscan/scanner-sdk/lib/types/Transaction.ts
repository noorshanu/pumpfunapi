export interface Transaction {
	tx: string;
	baseAmount: number;
	quoteAmount: number;
	owner: string;
	mint: string;
	createdAt: Date;
}
