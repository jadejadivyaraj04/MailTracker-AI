import 'dotenv/config';
import { connectDB } from './db.js';
import Message from './models/Message.js';
import OpenEvent from './models/OpenEvent.js';
import ClickEvent from './models/ClickEvent.js';
import mongoose from 'mongoose';

const clearData = async () => {
    // Allow passing URI via argument or env var
    const uri = process.env.MONGO_URI || process.argv[2];

    if (!uri) {
        console.error('Error: MONGO_URI is not set in environment or passed as argument.');
        console.error('Usage: MONGO_URI=... node clear-database.js');
        console.error('   OR: node clear-database.js <mongo_uri>');
        process.exit(1);
    }

    // Set env var so db.js picks it up
    process.env.MONGO_URI = uri;

    try {
        console.log('Connecting to database...');
        await connectDB(uri);

        console.log('Clearing all data...');

        const messages = await Message.deleteMany({});
        console.log(`Deleted ${messages.deletedCount} messages.`);

        const opens = await OpenEvent.deleteMany({});
        console.log(`Deleted ${opens.deletedCount} open events.`);

        const clicks = await ClickEvent.deleteMany({});
        console.log(`Deleted ${clicks.deletedCount} click events.`);

        console.log('All data cleared successfully.');

        // Close connection
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('Error clearing data:', error);
        process.exit(1);
    }
};

clearData();
