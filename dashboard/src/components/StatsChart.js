import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const formatDate = value => {
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
  } catch (error) {
    return value;
  }
};

function StatsChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tickFormatter={formatDate} stroke="#94a3b8" />
        <YAxis allowDecimals={false} stroke="#94a3b8" />
        <Tooltip labelFormatter={formatDate} />
        <Legend />
        <Line type="monotone" dataKey="opens" stroke="#1a73e8" strokeWidth={3} dot={false} />
        <Line type="monotone" dataKey="clicks" stroke="#10b981" strokeWidth={3} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default StatsChart;
