import React    from 'react'
import ReactDOM from 'react-dom/client'
import App      from './App.jsx'
import * as L   from 'leaflet'

// georaster-layer-for-leaflet requires L on window
window.L = L

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('💥 Crash:', error)
    console.error('💥 Stack:', info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#b91c1c', padding: '2rem', background: '#fff', fontFamily: 'monospace' }}>
          <h2>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)