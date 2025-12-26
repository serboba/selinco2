// Simple test to verify the setup
const fs = require('fs');
const path = require('path');

console.log('Testing setup...\n');

// Check if data file exists
const dataPath = path.join(__dirname, 'public', 'data.csv');
if (fs.existsSync(dataPath)) {
  console.log('✓ data.csv found in public folder');
  const stats = fs.statSync(dataPath);
  console.log(`  Size: ${(stats.size / 1024).toFixed(2)} KB`);
} else {
  console.log('✗ data.csv NOT found in public folder');
}

// Check if node_modules exists
const nodeModulesPath = path.join(__dirname, 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  console.log('✓ node_modules found');
} else {
  console.log('✗ node_modules NOT found - run npm install');
}

// Check package.json
const packagePath = path.join(__dirname, 'package.json');
if (fs.existsSync(packagePath)) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  console.log(`✓ package.json found (vite: ${pkg.devDependencies.vite})`);
} else {
  console.log('✗ package.json NOT found');
}

// Check source files
const srcFiles = [
  'src/App.jsx',
  'src/main.jsx',
  'src/App.css',
  'src/utils/dataParser.js'
];

console.log('\nChecking source files:');
srcFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file}`);
  } else {
    console.log(`✗ ${file} NOT found`);
  }
});

console.log('\nSetup check complete!');
console.log('\nTo start the dev server, run: npm run dev');

