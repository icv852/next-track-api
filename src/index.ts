import createKoaApp from './app'
import http from 'http'

const PORT = process.env.PORT || 4000

const main = (): void => {
    try {
        const app = createKoaApp()
        const server = http.createServer(app.callback())

        server.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}.`)
        })
    } catch (e) {
        console.error(`Failed to start server. Error: ${e}`)
    }
}

main()