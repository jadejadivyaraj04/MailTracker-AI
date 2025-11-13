import mongoose from 'mongoose';

const recipientSchema = new mongoose.Schema(
  {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] }
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    userId: { type: String, default: 'default' },
    subject: { type: String, default: '' },
    recipients: { type: recipientSchema, default: () => ({}) },
    sentAt: { type: Date, default: Date.now },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

export default Message;
