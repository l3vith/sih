import { WifiOff } from 'lucide-react'
import { useLang } from '../lang'

export default function AirgapToggle() {
  const { airgapped, setAirgapped, t } = useLang()
  return (
    <button
      type="button"
      className={`airgap-toggle${airgapped ? ' active' : ''}`}
      aria-pressed={airgapped}
      title={airgapped ? t('airgapOff') : t('airgapOn')}
      onClick={() => setAirgapped(!airgapped)}
    >
      <WifiOff size={13} />
      <span>{t('airgap')}</span>
    </button>
  )
}
