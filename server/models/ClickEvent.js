import mongoose from 'mongoose';

const clickEventSchema = new mongoose.Schema(
  {
    messageUid: { type: String, required: true, index: true },
    url: { type: String, required: true },
    ipHash: { type: String, required: true },
    userAgent: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

clickEventSchema.index({ messageUid: 1, createdAt: -1 });

export const ClickEvent = mongoose.models.ClickEvent || mongoose.model('ClickEvent', clickEventSchema);

export default ClickEvent;
