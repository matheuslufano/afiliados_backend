const express = require('express');

const router = express.Router();

let tocantinsCitiesCache = null;

const tocantinsCitiesFallback = [
  'Abreulândia',
  'Aguiarnópolis',
  'Aliança do Tocantins',
  'Almas',
  'Alvorada',
  'Ananás',
  'Angico',
  'Aparecida do Rio Negro',
  'Aragominas',
  'Araguacema',
  'Araguaçu',
  'Araguaína',
  'Araguanã',
  'Araguatins',
  'Arapoema',
  'Arraias',
  'Augustinópolis',
  'Aurora do Tocantins',
  'Axixá do Tocantins',
  'Babaçulândia',
  'Bandeirantes do Tocantins',
  'Barra do Ouro',
  'Barrolândia',
  'Bernardo Sayão',
  'Bom Jesus do Tocantins',
  'Brasilândia do Tocantins',
  'Brejinho de Nazaré',
  'Buriti do Tocantins',
  'Cachoeirinha',
  'Campos Lindos',
  'Cariri do Tocantins',
  'Carmolândia',
  'Carrasco Bonito',
  'Caseara',
  'Centenário',
  'Chapada de Areia',
  'Chapada da Natividade',
  'Colinas do Tocantins',
  'Colméia',
  'Combinado',
  'Conceição do Tocantins',
  'Couto Magalhães',
  'Cristalândia',
  'Crixás do Tocantins',
  'Darcinópolis',
  'Dianópolis',
  'Divinópolis do Tocantins',
  'Dois Irmãos do Tocantins',
  'Dueré',
  'Esperantina',
  'Fátima',
  'Figueirópolis',
  'Filadélfia',
  'Formoso do Araguaia',
  'Goianorte',
  'Goiatins',
  'Guaraí',
  'Gurupi',
  'Ipueiras',
  'Itacajá',
  'Itaguatins',
  'Itapiratins',
  'Itaporã do Tocantins',
  'Jaú do Tocantins',
  'Juarina',
  'Lagoa da Confusão',
  'Lagoa do Tocantins',
  'Lajeado',
  'Lavandeira',
  'Lizarda',
  'Luzinópolis',
  'Marianópolis do Tocantins',
  'Mateiros',
  'Maurilândia do Tocantins',
  'Miracema do Tocantins',
  'Miranorte',
  'Monte do Carmo',
  'Monte Santo do Tocantins',
  'Muricilândia',
  'Natividade',
  'Nazaré',
  'Nova Olinda',
  'Nova Rosalândia',
  'Novo Acordo',
  'Novo Alegre',
  'Novo Jardim',
  'Oliveira de Fátima',
  'Palmas',
  'Palmeirante',
  'Palmeiras do Tocantins',
  'Palmeirópolis',
  'Paraíso do Tocantins',
  'Paranã',
  "Pau D'Arco",
  'Pedro Afonso',
  'Peixe',
  'Pequizeiro',
  'Pindorama do Tocantins',
  'Piraquê',
  'Pium',
  'Ponte Alta do Bom Jesus',
  'Ponte Alta do Tocantins',
  'Porto Alegre do Tocantins',
  'Porto Nacional',
  'Praia Norte',
  'Presidente Kennedy',
  'Pugmil',
  'Recursolândia',
  'Riachinho',
  'Rio da Conceição',
  'Rio dos Bois',
  'Rio Sono',
  'Sampaio',
  'Sandolândia',
  'Santa Fé do Araguaia',
  'Santa Maria do Tocantins',
  'Santa Rita do Tocantins',
  'Santa Rosa do Tocantins',
  'Santa Tereza do Tocantins',
  'Santa Terezinha do Tocantins',
  'São Bento do Tocantins',
  'São Félix do Tocantins',
  'São Miguel do Tocantins',
  'São Salvador do Tocantins',
  'São Sebastião do Tocantins',
  'São Valério',
  'Silvanópolis',
  'Sítio Novo do Tocantins',
  'Sucupira',
  'Tabocão',
  'Taguatinga',
  'Taipas do Tocantins',
  'Talismã',
  'Tocantínia',
  'Tocantinópolis',
  'Tupirama',
  'Tupiratins',
  'Wanderlândia',
  'Xambioá'
].map((name, index) => ({
  id: index + 1,
  name,
  uf: 'TO'
}));

router.get('/cities/tocantins', async (req, res) => {
  try {
    if (tocantinsCitiesCache) {
      return res.json(tocantinsCitiesCache);
    }

    const response = await fetch(
      'https://servicodados.ibge.gov.br/api/v1/localidades/estados/TO/municipios'
    );

    if (!response.ok) {
      return res.json(tocantinsCitiesFallback);
    }

    const cities = await response.json();

    tocantinsCitiesCache = cities
      .map(city => ({
        id: city.id,
        name: city.nome,
        uf: 'TO'
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return res.json(tocantinsCitiesCache);
  } catch {
    return res.json(tocantinsCitiesFallback);
  }
});

module.exports = router;
