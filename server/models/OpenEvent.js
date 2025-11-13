import mongoose from 'mongoose';

const openEventSchema = new mongoose.Schema(
  {
    messageUid: { type: String, required: true, index: true },
    ipHash: { type: String, required: true },
    userAgent: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

openEventSchema.index({ messageUid: 1, createdAt: -1 });

export const OpenEvent = mongoose.models.OpenEvent || mongoose.model('OpenEvent', openEventSchema);

export default OpenEvent;
