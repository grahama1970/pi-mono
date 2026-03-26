import { EMBRY } from '../../sparta/common/EmbryStyle'

interface Props {
  message: string
  visible?: boolean
}

export function ReasoningToast({ message, visible = true }: Props) {
  if (!visible || !message) return null

  return (
    <div
      style={{
        backgroundColor: `${EMBRY.blue}18`,
        border: `1px solid ${EMBRY.blue}33`,
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: 12,
        color: EMBRY.blue,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: EMBRY.blue,
          boxShadow: `0 0 8px ${EMBRY.blue}99`,
          marginTop: 4,
          flexShrink: 0,
        }}
      />
      <span>{message}</span>
    </div>
  )
}
