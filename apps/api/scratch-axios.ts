import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import * as ical from 'node-ical';

const prisma = new PrismaClient();

async function run() {
  const schemaName = 'tenant_6a3b44fd_12fb_4a4f_87f9_eabe1f3bb49a';
  
  // Try to find the feed
  const feeds: any[] = await prisma.$queryRawUnsafe(`SELECT import_url, source FROM ${schemaName}.ical_feeds WHERE id IN ('eaec8318-bcdc-4ef1-9167-c01664cc01a5', '85a749ad-dc79-4f85-ba88-00b2dec86da5')`);
  
  for (const feed of feeds) {
    console.log('Fetching', feed.source, feed.import_url);
    try {
      const url = feed.import_url.trim().replace(/&amp;/g, '&');
      const res = await axios.get(url, {
          headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/calendar, text/plain, */*'
          },
          timeout: 10000,
          responseType: 'text'
      });
      console.log('Status:', res.status);
      console.log('Preview:', res.data.substring(0, 200).replace(/\n/g, ' '));
      const events = await ical.async.parseICS(res.data);
      console.log('Parsed events count:', Object.keys(events).length);
    } catch (e: any) {
      console.error('Error fetching', feed.source, e.message);
      if (e.response) {
         console.error(e.response.status, e.response.data?.substring(0, 200));
      }
    }
  }
}
run().finally(() => prisma.$disconnect());
