import {db} from '~/drizzle/db'
import {sql} from 'drizzle-orm'

// 避免使用 useNitroApp，直接在插件定义中使用 nitroApp 实例
export default defineNitroPlugin(async (nitroApp) => {
    // 全局未处理的Promise拒绝处理器
    // 注意：在某些 Serverless 环境中，process 对象可能不完整
    if (typeof process !== 'undefined' && process.on) {
        process.on('unhandledRejection', async (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason)

            // 检查是否是数据库连接错误
            if (reason && typeof reason === 'object' && 'message' in reason) {
                const errorMessage = (reason as Error).message

                if (errorMessage.includes('ECONNRESET') ||
                    errorMessage.includes('ENOTFOUND') ||
                    errorMessage.includes('ETIMEDOUT') ||
                    errorMessage.includes('Connection terminated') ||
                    errorMessage.includes('Connection lost')) {

                    console.log('Database connection error detected, attempting to reconnect...')

                    try {
                        // 尝试重新连接数据库
                        await new Promise(resolve => setTimeout(resolve, 2000)) // 等待2秒
                        console.log('Database reconnection successful')
                    } catch (reconnectError) {
                        console.error('Database reconnection failed:', reconnectError)
                    }
                }
            }

            console.log('Process will continue running despite the error')
        })

        // 全局未捕获异常处理器
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error)

            // 检查是否是数据库相关错误
            if (error.message.includes('ECONNRESET') ||
                error.message.includes('ENOTFOUND') ||
                error.message.includes('ETIMEDOUT')) {
                console.log('Database-related uncaught exception, process will continue')
                return // 不退出进程
            }

            console.error('Non-database uncaught exception, process will continue')
        })
    }

    // 定期健康检查
    // 在 Serverless 环境中，定时器可能无法持久运行，但对于 Node Functions 仍有一定价值
    const healthCheckInterval = setInterval(async () => {
        try {
            await db.execute(sql`SELECT 1 as health_check`)
        } catch (error) {
            console.error('Health check failed:', error)
        }
    }, 60000) // 每分钟检查一次

    // 在Nitro关闭时清理
    nitroApp.hooks.hook('close', () => {
        clearInterval(healthCheckInterval)
    })

    // 捕获 Nitro 错误
    nitroApp.hooks.hook('error', (error, { event }) => {
        console.error('[Nitro Error Hook] Error detected:', error.message)
        console.error('[Nitro Error Hook] Stack:', error.stack)
        if (event) {
            console.error('[Nitro Error Hook] Path:', event.path)
        }
    })

    // 数据库连接错误的特殊处理
    const originalExecute = db.execute
    db.execute = new Proxy(originalExecute, {
        apply: async (target, thisArg, argumentsList) => {
            try {
                return await target.apply(thisArg, argumentsList)
            } catch (error) {
                if (error.message.includes('ECONNRESET') ||
                    error.message.includes('Connection terminated')) {
                    console.log('Query failed due to connection reset, attempting to retry...')

                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000))
                        // 重试查询
                        return await target.apply(thisArg, argumentsList)
                    } catch (retryError) {
                        console.error('Query retry failed:', retryError)
                        throw retryError
                    }
                }
                throw error
            }
        }
    })

    console.log('Global error handler initialized')
})

