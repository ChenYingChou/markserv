'use strict'

// Markdown Extension Types
const fileTypes = {
	markdown: [
		'.markdown',
		'.mdown',
		'.mkdn',
		'.md',
		'.mkd',
		'.mdwn',
		'.mdtxt',
		'.mdtext',
		'.text'
	],
	html: [
		'.html',
		'.htm'
	],
	watch: [
		'.sass',
		'.less',
		'.js',
		'.css',
		'.json',
		'.gif',
		'.png',
		'.jpg',
		'.jpeg'
	]
}

fileTypes.watch = fileTypes.watch
	.concat(fileTypes.markdown)
	.concat(fileTypes.html)

const http = require('http')
const path = require('path')
const fs = require('fs')
const open = require('open')
const Promise = require('bluebird')
const connect = require('connect')
const less = require('less')
const send = require('send')
const liveReload = require('livereload')
const connectLiveReload = require('connect-livereload')
const chalk = require('chalk')
const implant = require('implant')
const deepmerge = require('deepmerge')

const MarkdownIt = require('markdown-it')
const mdItAnchor = require('markdown-it-anchor')
const mdItTaskLists = require('markdown-it-task-lists')
const mdItHLJS = require('markdown-it-highlightjs')

// JSDOM
// const jsdom = require('jsdom')
// const {JSDOM} = jsdom

const md = new MarkdownIt({
	linkify: true,
	html: true
})
	.use(mdItAnchor)
	.use(mdItTaskLists)
	.use(mdItHLJS)

const log = (str, flags, err) => {
	if (flags.silent) {
		return
	}
	if (str) {
		// eslint-disable-next-line no-console
		console.log(str)
	}

	if (err) {
		// eslint-disable-next-line no-console
		console.error(err)
	}
}
const msg = (type, msg, flags) =>
	log(chalk`{bgGreen.black  Markserv } {white  ${type}: }` + msg, flags)

const errormsg = (type, msg, flags, err) =>
	log(chalk`{bgRed.black  Markserv } {red  ${type}: }` + msg, flags, err)

const isType = (exts, filePath) => {
	const fileExt = path.parse(filePath).ext
	return exts.includes(fileExt)
}

// MarkdownToHTML: turns a Markdown file into HTML content
const markdownToHTML = markdownText => new Promise((resolve, reject) => {
	let result

	try {
		result = md.render(markdownText)
	} catch (err) {
		return reject(err)
	}

	resolve(result)
})

// GetFile: reads utf8 content from a file
const getFile = path => new Promise((resolve, reject) => {
	fs.readFile(path, 'utf8', (err, data) => {
		if (err) {
			return reject(err)
		}
		resolve(data)
	})
})

// Get Custom Less CSS to use in all Markdown files
const buildLessStyleSheet = cssPath =>
	new Promise(resolve =>
		getFile(cssPath).then(data =>
			less.render(data).then(data =>
				resolve(data.css)
			)
		)
	)

// // Linkify: converts github style wiki markdown links to .md links
// const linkify = (body, flags) => new Promise((resolve, reject) => {
// 	const dom = new JSDOM(body)

// 	if (!dom) {
// 		return reject(dom)
// 	}

// 	const {window} = dom

// 	const links = window.document.getElementsByTagName('a')
// 	const l = links.length

// 	let href
// 	let link
// 	let markdownFile
// 	let mdFileExists
// 	let relativeURL
// 	let isFileHref

// 	for (let i = 0; i < l; i++) {
// 		link = links[i]
// 		href = link.href
// 		isFileHref = href.substr(0, 8) === 'file:///'

// 		markdownFile = href.replace(path.join('file://', __dirname), flags.dir) + '.md'
// 		mdFileExists = fs.existsSync(markdownFile)

// 		if (isFileHref && mdFileExists) {
// 			relativeURL = href.replace(path.join('file://', __dirname), '') + '.md'
// 			link.href = relativeURL
// 		}
// 	}

// 	const html = window.document.getElementsByTagName('body')[0].innerHTML
// 	resolve(html)
// })
// .then(html => linkify(html, flags))

const baseTemplate = (templateUrl, content, filename) => new Promise((resolve, reject) => {
	getFile(templateUrl).then(template => {
		const output = template
			.replace('{{{content}}}', content)
			.replace('{{{title}}}', filename)
		resolve(output)
	}).catch(reject)
})

const compileAndSendDirectoryListing = (filepath, res, flags) => {
	const urls = fs.readdirSync(filepath)

	let list = '<ul>\n'

	let prettyPath = '/' + path.relative(process.cwd(), filepath)
	if (prettyPath[prettyPath.length] !== '/') {
		prettyPath += '/'
	}

	if (prettyPath.substr(prettyPath.length - 2, 2) === '//') {
		prettyPath = prettyPath.substr(0, prettyPath.length - 1)
	}

	urls.forEach(subPath => {
		const dir = fs.statSync(filepath + subPath).isDirectory()
		let href
		if (dir) {
			href = subPath + '/'
			list += `\t<li class="dir"><a href="${href}">${href}</a></li> \n`
		} else {
			href = subPath
			if (subPath.split('.md')[1] === '') {
				list += `\t<li class="md"><a href="${href}">${href}</a></li> \n`
			} else {
				list += `\t<li class="file"><a href="${href}">${href}</a></li> \n`
			}
		}
	})

	list += '</ul>\n'

	buildLessStyleSheet(flags.less).then(css => {
		const html = `
<!DOCTYPE html>
<head>
	<title>${prettyPath}</title>
	<meta charset="utf-8">
	<script src="https://code.jquery.com/jquery-2.1.1.min.js"></script>
	<script src="//cdnjs.cloudflare.com/ajax/libs/highlight.js/8.4/highlight.min.js"></script>
	<link rel="stylesheet" href="//cdnjs.cloudflare.com/ajax/libs/highlight.js/8.4/styles/default.min.css">
	<link rel="stylesheet" href="//highlightjs.org/static/demo/styles/github-gist.css">
	<link rel="shortcut icon" type="image/x-icon" href="https://cdn0.iconfinder.com/data/icons/octicons/1024/markdown-128.png" />
	<style>${css}</style>
</head>
<body>
	<article class="markdown-body">
		<h1>Index of ${prettyPath}</h1>${list}
		<sup><hr> Served by <a href="https://www.npmjs.com/package/markserv">MarkServ</a> | PID: ${process.pid}</sup>
		</article>
</body>`

		// Log if verbose

		if (flags.verbose) {
			msg('index', path, flags)
		}

		// Send file
		res.writeHead(200, {'Content-Type': 'text/html'})
		res.write(html)
		res.end()
	})
}

// Remove URL params from file being fetched
const getPathFromUrl = url => {
	return url.split(/[?#]/)[0]
}

// Http_request_handler: handles all the browser requests
const createRequestHandler = flags => {
	let dir = flags.dir
	const isDir = fs.statSync(dir).isDirectory()
	if (!isDir) {
		dir = path.parse(flags.dir).dir
		flags.$openLocation = path.relative(dir, flags.dir)
	}

	const implantOpts = {
		maxRecursion: 10
	}

	const implantHandlers = {
		less: (url, opts) => new Promise(resolve => {
			const absUrl = path.join(opts.baseDir, url)
			console.log('LESS')
			console.log(absUrl)

			buildLessStyleSheet(absUrl)
				.then(data => {
					msg('include', absUrl, flags)
					resolve(data)
				})
				.catch(err => {
					errormsg('404', absUrl, flags, err)
					resolve(false)
				})

			// getFile(absUrl).then(markdownToHTML)
			// 	.then(data => {
			// 		msg('include', absUrl, flags)
			// 		resolve(data)
			// 	})
			// 	.catch(err => {
			// 		errormsg('404', absUrl, flags, err)
			// 		resolve(false)
			// 	})
		}),

		markdown: (url, opts) => new Promise(resolve => {
			const absUrl = path.join(opts.baseDir, url)

			getFile(absUrl).then(markdownToHTML)
				.then(data => {
					msg('include', absUrl, flags)
					resolve(data)
				})
				.catch(err => {
					errormsg('404', absUrl, flags, err)
					resolve(false)
				})
		}),
		html: (url, opts) => new Promise(resolve => {
			const absUrl = path.join(opts.baseDir, url)

			getFile(absUrl)
				.then(data => {
					msg('include', absUrl, flags)
					resolve(data)
				})
				.catch(err => {
					errormsg('404', absUrl, flags, err)
					resolve(false)
				})
		})
	}

	return (req, res) => {
		const decodedUrl = getPathFromUrl(decodeURIComponent(req.originalUrl))
		const filePath = path.normalize(unescape(dir) + unescape(decodedUrl))
		const baseDir = path.parse(filePath).dir
		implantOpts.baseDir = baseDir

		if (flags.verbose) {
			msg('request', filePath, flags)
		}

		const prettyPath = filePath

		let stat
		let isDir
		let isMarkdown
		let isHtml

		try {
			stat = fs.statSync(filePath)
			isDir = stat.isDirectory()
			if (!isDir) {
				isMarkdown = isType(fileTypes.markdown, filePath)
				isHtml = isType(fileTypes.html, filePath)
			}
		} catch (err) {
			res.writeHead(200, {'Content-Type': 'text/html'})
			errormsg('404', filePath, flags, err)
			res.write(`404 :'( for ${prettyPath}`)
			res.end()
			return
		}

		// Markdown: Browser is requesting a Markdown file
		if (isMarkdown) {
			msg('markdown', prettyPath, flags)
			getFile(filePath).then(markdownToHTML).then(filePath).then(html => {
				return implant(html, implantHandlers, implantOpts).then(output => {
					const templateUrl = path.join(dir, 'templates/markdown.html')
					const filename = path.parse(filePath).base
					return baseTemplate(templateUrl, output, filename).then(final => {
						const lvl2Dir = path.parse(templateUrl).dir
						const lvl2Opts = deepmerge(implantOpts, {baseDir: lvl2Dir})
						return implant(final, implantHandlers, lvl2Opts).then(output => {
							res.writeHead(200, {
								'content-type': 'text/html'
							})
							res.end(output)
						})
					})
				})
			}).catch(err => {
				// eslint-disable-next-line no-console
				console.error(err)
			})
		} else if (isHtml) {
			msg('html', prettyPath, flags)
			getFile(filePath).then(html => {
				return implant(html, implantHandlers, implantOpts).then(output => {
					res.writeHead(200, {
						'content-type': 'text/html'
					})
					res.end(output)
				})
			}).catch(err => {
				// eslint-disable-next-line no-console
				console.error(err)
			})
		} else if (isDir) {
			// Index: Browser is requesting a Directory Index
			msg('dir', prettyPath, flags)
			compileAndSendDirectoryListing(filePath, res, flags)
		} else {
			// Other: Browser requests other MIME typed file (handled by 'send')
			msg('file', prettyPath, flags)
			send(req, filePath).pipe(res)
		}
	}
}

const startConnectApp = (liveReloadPort, httpRequestHandler) => {
	const connectApp = connect().use('/', httpRequestHandler)
	connectApp.use(connectLiveReload({
		port: liveReloadPort
	}))

	return connectApp
}

const startHTTPServer = (connectApp, port, flags) => {
	let httpServer

	if (connectApp) {
		httpServer = http.createServer(connectApp)
	} else {
		httpServer = http.createServer()
	}

	httpServer.listen(port, flags.address)
	return httpServer
}

const startLiveReloadServer = (liveReloadPort, flags) => {
	let dir = flags.dir
	const isDir = fs.statSync(dir).isDirectory()
	if (!isDir) {
		dir = path.parse(flags.dir).dir
	}

	const exts = fileTypes.watch.map(type => type.substr(1))

	return liveReload.createServer({
		exts,
		port: liveReloadPort
	}).watch(path.resolve(dir))
}

const logActiveServerInfo = (httpPort, liveReloadPort, flags) => {
	const serveURL = 'http://' + flags.address + ':' + httpPort
	const dir = path.resolve(flags.dir)

	msg('start', chalk`serving content from {white ${dir}} on port: {white ${httpPort}}`, flags)
	msg('address', chalk`{underline.white ${serveURL}}`, flags)
	msg('less', chalk`using style from {white ${flags.less}}`, flags)
	msg('livereload', chalk`communicating on port: {white ${liveReloadPort}}`, flags)

	if (process.pid) {
		msg('process', chalk`your pid is: {white ${process.pid}}`, flags)
		msg('info', chalk`to stop this server, press: {white [Ctrl + C]}, or type: {white "kill ${process.pid}"}`, flags)
	}

	if (flags.$openLocation) {
		open(serveURL + '/' + flags.$openLocation)
	}
}

const init = async flags => {
	const liveReloadPort = flags.livereloadport
	const httpPort = flags.port

	const httpRequestHandler = createRequestHandler(flags)
	const connectApp = startConnectApp(liveReloadPort, httpRequestHandler)
	const httpServer = await startHTTPServer(connectApp, httpPort, flags)

	let liveReloadServer
	if (liveReloadPort) {
		liveReloadServer = await startLiveReloadServer(liveReloadPort, flags)
	}

	// Log server info to CLI
	logActiveServerInfo(httpPort, liveReloadPort, flags)

	const service = {
		pid: process.pid,
		httpServer,
		liveReloadServer,
		connectApp
	}

	return service
}

module.exports = {
	getFile,
	markdownToHTML,
	init
}
