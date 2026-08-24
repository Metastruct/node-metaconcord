import { WebApp } from "@/app/services/webapp/index.js";

/** Nothing here is worth indexing, tell the clankers to go away. */
export default (webApp: WebApp): void => {
	webApp.app.get("/robots.txt", (_, res) => {
		res.type("text/plain").send("User-agent: *\nDisallow: /\n");
	});

	// crawlers probe this on spec; an empty sitemap answers 200 (logged at debug)
	// instead of a warn-level 404
	webApp.app.get("/sitemap.xml", (_, res) => {
		res.type("application/xml").send(
			'<?xml version="1.0" encoding="UTF-8"?>\n' +
				'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n'
		);
	});
};
