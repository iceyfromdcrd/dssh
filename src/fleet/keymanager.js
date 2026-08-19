import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { config } from '../config.js';

export class KeyManager {
  static get keysDir() {
    return path.join(config.dataDir, 'keys');
  }

  static get masterPrivateKeyPath() {
    return path.join(this.keysDir, 'dssh_master_key');
  }

  static get masterPublicKeyPath() {
    return path.join(this.keysDir, 'dssh_master_key.pub');
  }

  /**
   * Initializes or loads the cluster's master keypair in a format natively supported by ssh2
   */
  static ensureMasterKeys() {
    if (!fs.existsSync(this.keysDir)) {
      fs.mkdirSync(this.keysDir, { recursive: true });
    }

    let needsRegen = !fs.existsSync(this.masterPrivateKeyPath) || !fs.existsSync(this.masterPublicKeyPath);

    if (!needsRegen) {
      try {
        const keyContent = fs.readFileSync(this.masterPrivateKeyPath, 'utf-8');
        // If it contains unsupported generic PKCS8, regenerate with native ssh2 format
        if (keyContent.includes('-----BEGIN PRIVATE KEY-----')) {
          needsRegen = true;
        }
      } catch (_) {
        needsRegen = true;
      }
    }

    if (needsRegen) {
      console.log('[KEYMANAGER] Generating dedicated cluster SSH keypair...');

      let generated = false;

      // Try ssh-keygen for native OpenSSH ED25519 key if available
      try {
        try { fs.unlinkSync(this.masterPrivateKeyPath); } catch (_) {}
        try { fs.unlinkSync(this.masterPublicKeyPath); } catch (_) {}
        execSync(`ssh-keygen -t ed25519 -N "" -C "dssh-cluster-orchestrator" -f "${this.masterPrivateKeyPath}"`, { stdio: 'pipe' });
        generated = true;
      } catch (_) {
        // Fallback to crypto-generated RSA (PKCS#1) which ssh2 parses natively
        generated = false;
      }

      if (!generated) {
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
          modulusLength: 2048,
          publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
        });

        const pubOpenSSH = this.rsaPkcs1ToOpenSSH(publicKey);
        fs.writeFileSync(this.masterPrivateKeyPath, privateKey, { mode: 0o600 });
        fs.writeFileSync(this.masterPublicKeyPath, pubOpenSSH, { mode: 0o644 });
      }

      console.log('[KEYMANAGER] Cluster keys generated successfully in data/keys/');
    }

    return {
      privateKeyPath: this.masterPrivateKeyPath,
      publicKey: fs.readFileSync(this.masterPublicKeyPath, 'utf-8').trim()
    };
  }

  static getPublicKey() {
    const keys = this.ensureMasterKeys();
    return keys.publicKey;
  }

  static getPrivateKey() {
    this.ensureMasterKeys();
    return fs.readFileSync(this.masterPrivateKeyPath);
  }

  /**
   * Converts RSA PKCS1 PEM to standard OpenSSH authorized_keys format
   */
  static rsaPkcs1ToOpenSSH(pemString) {
    const rawB64 = pemString
      .replace(/-----[^\n]+-----/g, '')
      .replace(/\s+/g, '');
    const buffer = Buffer.from(rawB64, 'base64');
    
    // Parse RSAPublicKey DER (Sequence of modulus n and exponent e)
    let offset = 0;
    if (buffer[offset++] !== 0x30) throw new Error('Invalid RSA PKCS#1 DER');
    
    // Skip length byte(s)
    let len = buffer[offset++];
    if (len & 0x80) {
      const numBytes = len & 0x7f;
      offset += numBytes;
    }

    // Read Modulus (INTEGER)
    if (buffer[offset++] !== 0x02) throw new Error('Expected INTEGER for modulus');
    let modLen = buffer[offset++];
    if (modLen & 0x80) {
      const numBytes = modLen & 0x7f;
      modLen = 0;
      for (let i = 0; i < numBytes; i++) {
        modLen = (modLen << 8) | buffer[offset++];
      }
    }
    const modulus = buffer.subarray(offset, offset + modLen);
    offset += modLen;

    // Read Exponent (INTEGER)
    if (buffer[offset++] !== 0x02) throw new Error('Expected INTEGER for exponent');
    let expLen = buffer[offset++];
    if (expLen & 0x80) {
      const numBytes = expLen & 0x7f;
      expLen = 0;
      for (let i = 0; i < numBytes; i++) {
        expLen = (expLen << 8) | buffer[offset++];
      }
    }
    const exponent = buffer.subarray(offset, offset + expLen);

    const lengthPrefix = (buf) => {
      const l = Buffer.alloc(4);
      l.writeUInt32BE(buf.length, 0);
      return Buffer.concat([l, buf]);
    };

    const keyType = Buffer.from('ssh-rsa');
    const opensshBuffer = Buffer.concat([
      lengthPrefix(keyType),
      lengthPrefix(exponent),
      lengthPrefix(modulus)
    ]);

    return `ssh-rsa ${opensshBuffer.toString('base64')} dssh-cluster-orchestrator`;
  }
}
