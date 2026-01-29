import './TitleBar.scss'

interface TitleBarProps {
  title?: string
}

function TitleBar({ title }: TitleBarProps = {}) {
  return (
    <div className="title-bar">
      <img src="./logo.png" alt="WeFlow" className="title-logo" />
      <span className="titles">{title || 'WeFlow'}</span>
    </div>
  )
}

export default TitleBar
