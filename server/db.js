import mongoose from 'mongoose';

const { MONGO_URI } = process.env;

if (!MONGO_URI) {
  console.warn('[MailTracker AI] MONGO_URI is not set. Set it in your environment variables.');
}

export const connectDB = async (uri = process.env.MONGO_URI) => {
  if (!uri) {
    throw new Error('MONGO_URI must be provided to connect to MongoDB');
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('[MailTracker AI] Connected to MongoDB');
  } catch (error) {
    console.error('[MailTracker AI] MongoDB connection error', error);
    throw error;
  }
};

export default mongoose;
