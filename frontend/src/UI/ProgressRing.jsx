// Небольшое SVG-кольцо прогресса: трек + дуга через stroke-dashoffset (анимация
// перехода — в CSS .ai-ring__arc). По центру — подпись «n/total». Самостоятельный
// переиспользуемый примитив; цвет дуги задаётся пропсом color.
const ProgressRing = ({
  value = 0,
  max = 100,
  size = 54,
  stroke = 5,
  color = "var(--bs-success)",
  label,
}) => {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, value / safeMax));

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  const center = size / 2;

  const text = label ?? `${value}/${max}`;

  return (
    <svg
      className="ai-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Прогресс: ${value} из ${max}`}
    >
      <circle
        className="ai-ring__track"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="ai-ring__arc"
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <text
        className="ai-ring__label"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.28}
      >
        {text}
      </text>
    </svg>
  );
};

export default ProgressRing;
