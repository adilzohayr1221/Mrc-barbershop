import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// node-forge has bundled types via @types/node-forge
import forge from 'node-forge';
import JSZip from 'jszip';

const PASS_TYPE_ID = 'pass.com.mrc.barbershop';
const TEAM_ID = '756WTBLYPA';
const ORG_NAME = 'MRC Barbershops';

function certDir(): string {
  return process.env.WALLET_CERT_DIR || path.join(process.cwd(), 'certs');
}

interface PassFields {
  customerName: string;
  title: string;
  subtitle: string;
  serialNumber: string;
  membershipId?: string;
  extra?: { key: string; label: string; value: string }[];
}

function sha1(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex');
}

function buildPassJson(f: PassFields): object {
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    serialNumber: f.serialNumber,
    teamIdentifier: TEAM_ID,
    organizationName: ORG_NAME,
    description: `MRC Barbershops — ${f.title}`,
    foregroundColor: 'rgb(42, 33, 24)',
    backgroundColor: 'rgb(250, 245, 232)',
    labelColor: 'rgb(168, 130, 31)',
    storeCard: {
      headerFields: [{ key: 'member', label: 'MEMBER', value: f.customerName }],
      primaryFields: [{ key: 'title', label: 'MRC BARBERSHOPS', value: f.title }],
      secondaryFields: [{ key: 'valid', label: 'STATUS', value: f.subtitle }],
      auxiliaryFields: (f.extra || []).map((e) => ({
        key: e.key,
        label: e.label.toUpperCase(),
        value: e.value,
      })),
      backFields: [
        {
          key: 'terms',
          label: 'Terms',
          value: 'Present this card at MRC Barbershops. Non-transferable.',
        },
      ],
    },
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: f.membershipId ? `MRCW:${f.membershipId}` : `MRC:${f.serialNumber}`,
        messageEncoding: 'iso-8859-1',
      },
    ],
    // Lock-screen notification when the customer walks near either shop
    locations: [
      {
        latitude: 39.28954,
        longitude: -76.5933,
        relevantText: 'MRC Barbershops is nearby \u2014 your chair is waiting. Walk in for a fresh cut today.',
      },
      {
        latitude: 39.28052,
        longitude: -76.57518,
        relevantText: 'MRC Barbershops is nearby \u2014 your chair is waiting. Walk in for a fresh cut today.',
      },
    ],
  };
}

function loadLogoPng(): Buffer {
  const candidates = [
    path.join(process.cwd(), 'public', 'wallet-logo.png'),
    path.join(process.cwd(), 'public', 'logo.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p);
  }
  // 1x1 transparent PNG fallback
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

function signManifest(manifestBuf: Buffer, dir: string): Buffer {
  const certPem = fs.readFileSync(path.join(dir, 'signer-cert.pem'), 'utf8');
  const keyPem = fs.readFileSync(path.join(dir, 'signer-key.pem'), 'utf8');
  const wwdrPath = path.join(dir, 'wwdr-g4.pem');

  const cert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestBuf.toString('binary'));
  p7.addCertificate(cert);
  if (fs.existsSync(wwdrPath)) {
    const wwdr = forge.pki.certificateFromPem(fs.readFileSync(wwdrPath, 'utf8'));
    p7.addCertificate(wwdr);
  }
  p7.addSigner({
    key: privateKey,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(der, 'binary');
}

export async function generatePkpass(f: PassFields): Promise<Buffer> {
  const dir = certDir();
  const certPemPath = path.join(dir, 'signer-cert.pem');
  const keyPemPath = path.join(dir, 'signer-key.pem');
  if (!fs.existsSync(certPemPath) || !fs.existsSync(keyPemPath)) {
    throw new Error('Wallet signing certificate not configured.');
  }

  const passJson = Buffer.from(JSON.stringify(buildPassJson(f)));
  const logoPng = loadLogoPng();

  const manifest: Record<string, string> = {
    'pass.json': sha1(passJson),
    'icon.png': sha1(logoPng),
    'logo.png': sha1(logoPng),
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifest));

  const signature = signManifest(manifestBuf, dir);

  const zip = new JSZip();
  zip.file('pass.json', passJson);
  zip.file('manifest.json', manifestBuf);
  zip.file('signature', signature);
  zip.file('icon.png', logoPng);
  zip.file('logo.png', logoPng);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
