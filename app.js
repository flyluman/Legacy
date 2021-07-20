import helmet from 'helmet';
import express from 'express';
import mongodb from 'mongodb';
import fetch from 'node-fetch';
import session from 'express-session';

const app = express();
const DB = process.env.DB || null;
const URI = process.env.DBURI || null;
const MongoClient = mongodb.MongoClient;

app.use(helmet());
app.use(express.json());
app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SECRET || 'keyboard cat',
        resave: false,
        saveUninitialized: true,
        cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 },
    })
);

const logger = async (req, res, next) => {

    if (process.env.NODE_ENV === 'production') {
        if (req.headers['x-forwarded-proto'] !== 'https') return res.redirect(`https://luman.herokuapp.com${req.path}`);

        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;

        if (ip && (ip !== req.session.ip)) {
            try {
                let data = await fetch(`http://ip-api.com/json/${ip}`);
                if (data.ok) {
                    data = await data.json();
                    req.session.ip = data.query;
                    req.session.isp = data.isp;
                    req.session.city = data.city;
                    req.session.country = data.country;
                } else {
                    req.session.ip = req.session.isp = req.session.city = req.session.country = 'Failed to detect';
                }
            } catch (err) {
                console.log(err.stack);
            }
        }

        let cluster, collection = 'log';
        if (!(req.country === 'BD' || req.country === 'Bangladesh')) collection = 'foreign-log';

        try {
            cluster = await MongoClient.connect(URI);
            const db = cluster.db(DB);

            await db.collection(collection).insertOne({
                ip: req.session.ip,
                isp: req.session.isp,
                city: req.session.city,
                country: req.session.country,
                date: new Date(Date.now() + 21600000).toUTCString() + '+06',
                path: req.path,
                useragent: req.headers['user-agent']
            });

        } catch (err) {
            console.log(err.stack);
        }
        cluster.close();
    }
    next();
};

app.get('/', logger, (req, res) => {
    res.render('./pages/home', { ip: req.session.ip, isp: req.session.isp, city: req.session.city, country: req.session.country });
});

app.post('/messenger', logger, async (req, res) => {
    let cluster;

    try {
        cluster = await MongoClient.connect(URI);
        const db = cluster.db(DB);

        await db.collection('msg').insertOne({
            ip: req.session.ip,
            isp: req.session.isp,
            city: req.session.city,
            country: req.session.country,
            date: new Date(Date.now() + 21600000).toUTCString() + '+06',
            useragent: req.headers['user-agent'] || null,
            name: req.body.name || null,
            email: req.body.email || null,
            msg: req.body.msg || null,
        });

        res.redirect('https://luman.herokuapp.com');

    } catch (err) {
        console.log(err.stack);
    }
    cluster.close();
});

app.post('/query', async (req, res) => {

    if (req.body.name && req.body.pass && req.body.pass === process.env.QUERYPASS && req.body.name.match(/foreign-log|log|msg/g)) {

        let cluster;

        try {
            cluster = await MongoClient.connect(URI);
            const db = cluster.db(DB);

            let data = await db.collection(req.body.name).find().toArray();
            res.json(data);
        } catch (err) {
            console.log(err.stack);
            res.json({ 'query': 'failed' });
        }
        cluster.close();
    }
    else res.status(401).send('Unauthorized request to server.');
});

app.delete('/query', async (req, res) => {
    if (req.body.name && req.body.pass && req.body.pass === process.env.QUERYPASS && req.body.name.match(/foreign-log|log|msg/g)) {

        let cluster;

        try {
            cluster = await MongoClient.connect(URI);
            const db = cluster.db(DB);

            await db.collection(req.body.name).deleteMany({});
            res.json({ 'delete': 'success' });
        } catch (err) {
            console.log(err.stack);
            res.json({ 'delete': 'failed' });
        }
        cluster.close();
    }
    else res.status(401).send('Unauthorized request to server.');
});

app.use(express.static('./public'));
app.all('*', logger, (req, res) => res.status(404).render('./pages/404'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening at port ${PORT}`));