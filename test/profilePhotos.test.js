const test = require('node:test');
const assert = require('node:assert/strict');
const {
  profilePhotoUrl,
  storedProfilePhotoUrl
} = require('../src/utils/profilePhotos');

test('gera avatar Glass animado para perfil sem foto', () => {
  const url = new URL(profilePhotoUrl('affiliate', 'Maria Silva'));
  assert.equal(url.pathname, '/10.x/glass/svg');
  assert.equal(url.searchParams.get('animationVariant'), 'medium');
  assert.ok(url.searchParams.get('seed'));
});

test('substitui avatares DiceBear antigos pelo Glass animado', () => {
  const oldAvatar = 'https://api.dicebear.com/10.x/sprouts/svg?seed=joao&animationVariant=medium';
  const migrated = new URL(storedProfilePhotoUrl(oldAvatar, 'user', 'João Silva'));
  assert.equal(migrated.pathname, '/10.x/glass/svg');
  assert.equal(migrated.searchParams.get('animationVariant'), 'medium');
});

test('preserva foto enviada pelo usuário', () => {
  const uploaded = 'https://example.com/profile/photo.jpg';
  assert.equal(storedProfilePhotoUrl(uploaded, 'user', 10), uploaded);
});
