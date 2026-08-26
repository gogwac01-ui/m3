const cheerio = require('cheerio');

const TRAVEL_HOSTS = ['pkgtour.naver.com', 'travel.naver.com'];
const TRAVEL_LD_TYPES = ['TouristTrip', 'Trip', 'TravelAction', 'TouristAttraction'];

function detectProductType(finalUrl, ld) {
  try {
    const host = new URL(finalUrl).hostname;
    if (TRAVEL_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return 'travel';
  } catch (e) {}
  if (ld) {
    const type = ld['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (types.some((t) => TRAVEL_LD_TYPES.includes(t))) return 'travel';
  }
  return 'shopping';
}

function extractProductInfo(html, finalUrl) {
  const $ = cheerio.load(html);
  const og = (prop) => $(`meta[property="og:${prop}"]`).attr('content') || null;
  const metaName = (name) => $(`meta[name="${name}"]`).attr('content') || null;

  let ld = null;
  let ldTravel = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try { parsed = JSON.parse($(el).contents().text()); } catch (e) { return; }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      const type = c['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (!ld && types.includes('Product')) ld = c;
      if (!ldTravel && types.some((t) => TRAVEL_LD_TYPES.includes(t))) ldTravel = c;
    }
  });

  const productType = detectProductType(finalUrl, ld || ldTravel);
  const productName = ((ld || ldTravel) && (ld || ldTravel).name) || og('title') || $('title').first().text().trim() || null;
  const description = og('description') || metaName('description') || null;

  const images = new Set();
  if (og('image')) images.add(og('image'));
  const ldForImage = ld || ldTravel;
  if (ldForImage && ldForImage.image) {
    const imgs = Array.isArray(ldForImage.image) ? ldForImage.image : [ldForImage.image];
    imgs.forEach((i) => typeof i === 'string' && images.add(i));
  }
  $('meta[property="og:image"]').each((_, el) => {
    const c = $(el).attr('content');
    if (c) images.add(c);
  });

  let extracted;
  if (productType === 'travel') {
    let price = null;
    let currency = null;
    if (ldTravel && ldTravel.offers) {
      const offer = Array.isArray(ldTravel.offers) ? ldTravel.offers[0] : ldTravel.offers;
      if (offer) {
        price = offer.price != null ? String(offer.price) : null;
        currency = offer.priceCurrency || null;
      }
    }
    if (!price) {
      const ogPriceAmount = $('meta[property="product:price:amount"]').attr('content');
      if (ogPriceAmount) price = ogPriceAmount;
      currency = currency || $('meta[property="product:price:currency"]').attr('content') || null;
    }

    const agency = (ldTravel && ldTravel.provider && (typeof ldTravel.provider === 'string' ? ldTravel.provider : ldTravel.provider.name)) || metaName('author') || null;

    extracted = {
      productType: 'travel', productName, category: (ldTravel && ldTravel.category) || null,
      price, currency, seller: agency, images: Array.from(images), description,
      productUrl: finalUrl, affiliateUrl: null,
      travel: {
        departureDate: (ldTravel && ldTravel.startDate) || null,
        returnDate: (ldTravel && ldTravel.endDate) || null,
        duration: (ldTravel && ldTravel.duration) || null,
        destination: (ldTravel && ldTravel.itinerary && ldTravel.itinerary.name) || (ldTravel && ldTravel.arrivalCountry && ldTravel.arrivalCountry.name) || null,
        includedItems: (ldTravel && ldTravel.includesObject) || null,
      },
      brand: null,
      option: null,
    };
  } else {
    const brand = (ld && ld.brand && (typeof ld.brand === 'string' ? ld.brand : ld.brand.name)) || metaName('author') || null;
    let price = null;
    let currency = null;
    if (ld && ld.offers) {
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (offer) {
        price = offer.price != null ? String(offer.price) : null;
        currency = offer.priceCurrency || null;
      }
    }
    if (!price) {
      const ogPriceAmount = $('meta[property="product:price:amount"]').attr('content');
      if (ogPriceAmount) price = ogPriceAmount;
      currency = currency || $('meta[property="product:price:currency"]').attr('content') || null;
    }

    const seller = (ld && ld.offers && (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers)?.seller?.name) || null;

    extracted = {
      productType: 'shopping', productName, brand, category: (ld && ld.category) || null,
      price, currency, seller, option: null, images: Array.from(images), description,
      productUrl: finalUrl, affiliateUrl: null, travel: null,
    };
  }

  const missing = [];
  if (!extracted.productName) missing.push('productName');
  if (extracted.images.length === 0) missing.push('images');
  return { extracted, missing, hasJsonLd: !!(ld || ldTravel), productType };
}

module.exports = { extractProductInfo, detectProductType };
