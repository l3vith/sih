import { useLang } from '../lang'

export default function LanguageToggle() {
  const { lang, setLang, t } = useLang()
  const isHindi = lang === 'hi'
  return (
    <div
      className="lang-toggle"
      role="group"
      aria-label={t('language')}
      title={isHindi ? t('switchToEn') : t('switchToHi')}
    >
      <button
        type="button"
        className={isHindi ? '' : 'active'}
        aria-pressed={!isHindi}
        onClick={() => setLang('en')}
      >
        EN
      </button>
      <button
        type="button"
        className={isHindi ? 'active' : ''}
        aria-pressed={isHindi}
        onClick={() => setLang('hi')}
      >
        हिं
      </button>
    </div>
  )
}
