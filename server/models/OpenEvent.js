import mongoose from 'mongoose';

const openEventSchema = new mongoose.Schema(
  {
    messageUid: { type: String, required: true, index: true },
    recipientEmail: { type: String, index: true }, // Track which recipient opened (for single-recipient emails)
    ipHash: { type: String, required: true },
    userAgent: { type: String },
    isProxy: { type: Boolean, default: false },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

openEventSchema.index({ messageUid: 1, createdAt: -1 });

export const OpenEvent = mongoose.models.OpenEvent || mongoose.model('OpenEvent', openEventSchema);

export default OpenEvent;
