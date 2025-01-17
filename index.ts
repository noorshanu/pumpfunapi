import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import bodyParser from 'body-parser';
import connectDB from './config/db';
import tokenRoutes from './routes/tokenRoutes';
import projectRoutes from './routes/projectRoutes';
import transactionRoutes from './routes/transactionRoutes';

dotenv.config();
const app = express();


const corsOptions = {
    credentials: true,
    origin: ['http://localhost:3000', 'https://pfun.blocktools.ai'], // Whitelisted domains
};
// Connect to MongoDB
connectDB();

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());

// Routes
app.use('/api/token', tokenRoutes);  
app.use('/api/project', projectRoutes);
app.use('/api/transaction', transactionRoutes);

const PORT = process.env.PORT || 5000;               
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));



