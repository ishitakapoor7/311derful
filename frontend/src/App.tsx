import { useRoute } from './lib/router'
import { Header } from './components/Header'
import { Landing } from './screens/Landing'
import { Ask } from './screens/Ask'
import { Explore } from './screens/Explore'

export default function App() {
  const route = useRoute()

  return (
    <>
      <Header route={route} />
      <main>
        {route === 'landing' && <Landing />}
        {route === 'ask' && <Ask />}
        {route === 'explore' && <Explore />}
      </main>
    </>
  )
}
