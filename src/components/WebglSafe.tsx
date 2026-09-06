import { useCallback, useState } from 'react'
import { Canvas, type CanvasProps, type RootState } from '@react-three/fiber'
import { useLang } from '../lang'

// Wraps R3F Canvas: if the browser kills the WebGL context (GPU pressure,
// tab sleep, driver reset), show a retry card instead of a dead black canvas.
export default function WebglSafe({ onCreated, children, ...rest }: CanvasProps) {
  const { t } = useLang()
  const [lost, setLost] = useState(false)
  const [nonce, setNonce] = useState(0)
  const handleCreated = useCallback((state: RootState) => {
    try {
      state.gl.domElement.addEventListener('webglcontextlost', (event) => {
        event.preventDefault()
        setLost(true)
      }, { once: true })
    } catch { /* non-WebGL environment — leave to R3F error handling */ }
    onCreated?.(state)
  }, [onCreated])
  if (lost) {
    return <div className="webgl-fallback" role="status">
      <b>{t('webglLost')}</b>
      <span>{t('webglHint')}</span>
      <button onClick={() => { setNonce((n) => n + 1); setLost(false) }}>{t('webglRetry')}</button>
    </div>
  }
  return <Canvas key={nonce} onCreated={handleCreated} {...rest}>{children}</Canvas>
}
