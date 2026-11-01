// import express, {Application, Request, Response, NextFunction} from 'express';

import express, { Request, Response} from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { calculateQueueWaitTimes } from './services/calculator';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({status: 'ok', message: 'MediQueue Sever Operational' });
});

app.get('/api/v1/queues/estimate-test', (req: Request, res: Response) => {
    const mockWaitingList = [
        {ticketId: 101, appointmentTime: new Date(), isFirstVisit: true },
        {ticketId: 102, appointmentTime: new Date(), isFirstVisit: false },
        {ticketId: 103, appointmentTime: new Date(), isFirstVisit: false },
    ];

    const currentEWMA = 12.5;
    const lastcompletionTime = new Date();

    const results = calculateQueueWaitTimes(
        mockWaitingList,
        currentEWMA,
        lastcompletionTime
    );

    res.json({
        success: true,
        doctorCurrentEWMA: currentEWMA,
        waitingCount: mockWaitingList.length,
        results,
    });
});

export default app;