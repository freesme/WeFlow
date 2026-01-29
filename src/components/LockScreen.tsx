import { useState, useEffect, useRef } from 'react'
import * as configService from '../services/config'
import { ArrowRight, Fingerprint, Lock, ShieldCheck } from 'lucide-react'
import './LockScreen.scss'

interface LockScreenProps {
    onUnlock: () => void
    avatar?: string
    useHello?: boolean
}

async function sha256(message: string) {
    const msgBuffer = new TextEncoder().encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex
}

export default function LockScreen({ onUnlock, avatar, useHello = false }: LockScreenProps) {
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [isVerifying, setIsVerifying] = useState(false)
    const [isUnlocked, setIsUnlocked] = useState(false)
    const [showHello, setShowHello] = useState(false)
    const [helloAvailable, setHelloAvailable] = useState(false)

    // 用于取消 WebAuthn 请求
    const abortControllerRef = useRef<AbortController | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        // 快速检查配置并启动
        quickStartHello()
        inputRef.current?.focus()

        return () => {
            // 组件卸载时取消请求
            abortControllerRef.current?.abort()
        }
    }, [])

    const handleUnlock = () => {
        setIsUnlocked(true)
        setTimeout(() => {
            onUnlock()
        }, 1500)
    }

    const quickStartHello = async () => {
        try {
            // 如果父组件已经告诉我们要用 Hello，直接开始，不等待 IPC
            let shouldUseHello = useHello

            // 为了稳健，如果 prop 没传（虽然现在都传了），再 check 一次 config
            if (!shouldUseHello) {
                shouldUseHello = await configService.getAuthUseHello()
            }

            if (shouldUseHello) {
                // 标记为可用，显示按钮
                setHelloAvailable(true)
                setShowHello(true)
                // 立即执行验证 (0延迟)
                verifyHello()

                // 后台再次确认可用性，如果其实不可用，再隐藏? 
                // 或者信任用户的配置。为了速度，我们优先信任配置。
                if (window.PublicKeyCredential) {
                    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
                        .then(available => {
                            if (!available) {
                                // 如果系统报告不支持，但配置开了，我们可能需要提示?
                                // 暂时保持开启状态，反正 verifyHello 会报错
                            }
                        })
                }
            }
        } catch (e) {
            console.error('Quick start hello failed', e)
        }
    }

    const verifyHello = async () => {
        if (isVerifying || isUnlocked) return

        // 取消之前的请求（如果有）
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        const abortController = new AbortController()
        abortControllerRef.current = abortController

        setIsVerifying(true)
        setError('')
        try {
            const challenge = new Uint8Array(32)
            window.crypto.getRandomValues(challenge)

            const rpId = 'localhost'
            const credential = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    rpId,
                    userVerification: 'required',
                },
                signal: abortController.signal
            })

            if (credential) {
                handleUnlock()
            }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                console.log('Hello verification aborted')
                return
            }
            if (e.name === 'NotAllowedError') {
                console.log('User cancelled Hello verification')
            } else {
                console.error('Hello verification error:', e)
                // 仅在非手动取消时显示错误
                if (e.name !== 'AbortError') {
                    setError(`验证失败: ${e.message || e.name}`)
                }
            }
        } finally {
            if (!abortController.signal.aborted) {
                setIsVerifying(false)
            }
        }
    }

    const handlePasswordSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault()
        if (!password || isUnlocked) return

        // 如果正在进行 Hello 验证，取消它
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
        }

        // 不再检查 isVerifying，因为我们允许打断 Hello
        setIsVerifying(true)
        setError('')

        try {
            const storedHash = await configService.getAuthPassword()
            const inputHash = await sha256(password)

            if (inputHash === storedHash) {
                handleUnlock()
            } else {
                setError('密码错误')
                setPassword('')
                setIsVerifying(false)
                // 如果密码错误，是否重新触发 Hello? 
                // 用户可能想重试密码，暂时不自动触发
            }
        } catch (e) {
            setError('验证失败')
            setIsVerifying(false)
        }
    }

    return (
        <div className={`lock-screen ${isUnlocked ? 'unlocked' : ''}`}>
            <div className="lock-content">
                <div className="lock-avatar">
                    {avatar ? (
                        <img src={avatar} alt="User" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                    ) : (
                        <Lock size={40} />
                    )}
                </div>

                <h2 className="lock-title">WeFlow 已锁定</h2>

                <form className="lock-form" onSubmit={handlePasswordSubmit}>
                    <div className="input-group">
                        <input
                            ref={inputRef}
                            type="password"
                            placeholder="输入应用密码"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        // 移除 disabled，允许用户随时输入
                        />
                        <button type="submit" className="submit-btn" disabled={!password}>
                            <ArrowRight size={18} />
                        </button>
                    </div>

                    {showHello && (
                        <button
                            type="button"
                            className={`hello-btn ${isVerifying ? 'loading' : ''}`}
                            onClick={verifyHello}
                        >
                            <Fingerprint size={20} />
                            {isVerifying ? '验证中...' : '使用 Windows Hello 解锁'}
                        </button>
                    )}
                </form>

                {error && <div className="lock-error">{error}</div>}
            </div>
        </div>
    )
}
