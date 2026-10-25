import { ArrowForwardRounded } from '@mui/icons-material'
import { Button } from '@mui/material'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import RhineSignalLoop from '@/assets/image/rhine-signal-loop.svg?react'
import { useSystemState } from '@/hooks/use-system-state'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVisibility } from '@/hooks/use-visibility'
import parseTraffic from '@/utils/parse-traffic'
import { isRhinePreview } from '@/utils/rhine-preview'

const RhineSignal = memo(RhineSignalLoop)

const pixelGlyphs: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '.': ['0', '0', '0', '0', '0', '1', '1'],
  '—': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '/': ['00001', '00001', '00010', '00100', '01000', '10000', '10000'],
  s: ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
}

const pixelText = (text: string) => {
  let width = 0
  let path = ''
  for (const character of text) {
    const glyph = pixelGlyphs[character]
    for (const [y, row] of glyph.entries()) {
      for (const [x, pixel] of [...row].entries()) {
        if (pixel === '1') path += `M${width + x} ${y}h1v1h-1Z`
      }
    }
    width += glyph[0].length + 1
  }
  return { path, width: width - 1 }
}

export const RhineOverview = ({ hasProfile }: { hasProfile: boolean }) => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { runningMode, isLoading } = useSystemState()
  const pageVisible = useVisibility()
  const {
    response: { data: traffic, error: trafficError },
  } = useTrafficData({ enabled: pageVisible && !isRhinePreview })
  const schematicRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const schematic = schematicRef.current
    if (!schematic) return

    let inView = false
    const updateMotion = () => {
      schematic.dataset.motion =
        inView && !document.hidden && document.hasFocus() ? 'running' : 'paused'
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      updateMotion()
    })
    observer.observe(schematic)
    document.addEventListener('visibilitychange', updateMotion)
    window.addEventListener('focus', updateMotion)
    window.addEventListener('blur', updateMotion)

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', updateMotion)
      window.removeEventListener('focus', updateMotion)
      window.removeEventListener('blur', updateMotion)
    }
  }, [])
  const zh = i18n.language.startsWith('zh')
  const running = runningMode !== 'NotRunning'
  const hasTraffic = !isRhinePreview && !isLoading && running && !trafficError
  const [down, downUnit] = hasTraffic
    ? parseTraffic(traffic?.down ?? 0)
    : ['—', 'B']
  const [up, upUnit] = hasTraffic ? parseTraffic(traffic?.up ?? 0) : ['—', 'B']
  const downloadPixels = pixelText(down)
  const downloadUnitPixels = pixelText(`${downUnit}/s`)
  const downloadLabel = t('home.components.traffic.metrics.downloadSpeed')
  const uploadLabel = t('home.components.traffic.metrics.uploadSpeed')
  const status = isRhinePreview
    ? zh
      ? '隔离预览 · 连接保持不变'
      : 'Isolated UI preview'
    : isLoading
      ? zh
        ? '正在读取内核状态'
        : 'Reading core status'
      : running
        ? zh
          ? '内核运行中'
          : 'Core running'
        : zh
          ? '内核未运行'
          : 'Core stopped'
  return (
    <div className="rhine-overview">
      <div className="rhine-overview-copy">
        <span className="rhine-eyebrow">CLASH VERGE / RHINE EDITION</span>
        <h2>{zh ? '连接，自有秩序。' : 'Every connection. In order.'}</h2>
        <p>
          {hasProfile
            ? zh
              ? '查看网络状态，掌控每一条连接。'
              : 'Observe your network. Control every connection.'
            : zh
              ? '从一份配置开始，建立你的网络。'
              : 'Import a profile to set up your network.'}
        </p>
        <div className="rhine-overview-actions">
          <Button
            variant="contained"
            disableElevation
            endIcon={<ArrowForwardRounded />}
            onClick={() =>
              navigate(hasProfile ? '/proxies' : '/profile', {
                viewTransition: true,
              })
            }
          >
            {hasProfile
              ? zh
                ? '管理代理'
                : 'Manage proxies'
              : zh
                ? '导入配置'
                : 'Import profile'}
          </Button>
          <span className="rhine-core-status">
            <i data-running={!isLoading && running} />
            {status}
          </span>
        </div>
      </div>
      <div
        className="rhine-schematic"
        ref={schematicRef}
        role="img"
        aria-label={`${uploadLabel}: ${up} ${upUnit}/s; ${downloadLabel}: ${down} ${downUnit}/s`}
      >
        <div className="rhine-signal-display" aria-hidden="true">
          <RhineSignal focusable="false" />
          <svg
            className="rhine-signal-readout rhine-signal-instruments rhine-signal-motion"
            viewBox="0 0 256 256"
            focusable="false"
          >
            <g textAnchor="end">
              <text
                className="rhine-signal-upload"
                x="183"
                y="103"
                fontSize={up.length > 4 ? 56 : up.length > 3 ? 66 : 84}
                textLength={up.length > 3 ? 126 : 116}
                lengthAdjust="spacingAndGlyphs"
              >
                {up}
              </text>
              <text
                className="rhine-signal-upload-unit"
                textAnchor="start"
                x="191"
                y="103"
              >
                {upUnit}/s
              </text>
              <path
                className="rhine-signal-download"
                d={downloadPixels.path}
                transform={`translate(${145 - downloadPixels.width * 2.6} 172) scale(2.6)`}
              />
              <path
                className="rhine-signal-download-unit"
                d={downloadUnitPixels.path}
                transform="translate(153 182.5) scale(1.1)"
              />
            </g>
          </svg>
          <svg
            className="rhine-signal-crt"
            viewBox="0 0 256 256"
            focusable="false"
          >
            <circle
              cx="128"
              cy="128"
              r="106"
              fill="url(#rhine-signal-scanlines)"
            />
          </svg>
        </div>
        <span>NETWORK CONTROL</span>
      </div>
    </div>
  )
}
