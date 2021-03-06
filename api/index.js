import express from 'express'
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import ldap from './ldap';
import _ from 'lodash';

import {Plate, Master, Stock, MasterPlate} from './models'
import calculateWellsForMasterPlate from './calculateWellsForMasterPlate';

try {
  mongoose.connect('mongodb://localhost:27017/fridge', {useNewUrlParser: true});
} catch (err) {
  console.error(err);
}

const ObjectId = mongoose.Types.ObjectId;

const labels = [
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12',
  'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11', 'b12',
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12',
  'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12',
  'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10', 'h11', 'h12',
];


const labelsChunked = _.chunk(labels, 12);


function getKeysForNewMaster(replicates) {

  const newOrder = [];
  for (let slim = 0; slim + replicates <= 12; slim += replicates) {
    for (let thicc = 0; thicc < 8; thicc++) {//because its 8 wide
      for (let offset = 0; offset < replicates; offset++) {
        newOrder.push(labelsChunked[thicc][slim + offset])
      }
    }
  }

  newOrder.splice(0, 2 * replicates); //make empty spaces
  return newOrder
}


String.prototype.toObjectId = function () {
  return new ObjectId(this.toString());
};


function sendError(error, res, code) {
  console.error(error);
  res.status(code || 500).json({error: error})
}

// Create express router
const router = express.Router();

// Transform req & res to have the same API as express
// So we can use res.status() & res.json()
const app = express();
router.use((req, res, next) => {
  Object.setPrototypeOf(req, app.request);
  Object.setPrototypeOf(res, app.response);
  req.res = res;
  res.req = req;
  next()
});

const JWT_SECRET = process.env.JWT_SECRET;

async function sign(user) {
  return jwt.sign(user, JWT_SECRET)
}


router.get('/stock', (req, res) => {

  Stock.find({deleted: false})
    .then(stocks => {
      const sorted = stocks.filter(s => !s.deleted).reduce((all, current) => {
        current.active ? all.stocksActive.push(current) : all.stocksRetired.push(current);
        return all;
      }, {stocksActive: [], stocksRetired: []});
      res.status(200).json(sorted)
    })
    .catch(err => {
      sendError(err, res)
    })

});

router.get('/stock/:id', (req, res) => {
  Stock.findById(req.params.id)
    .populate('plate')
    .then(stock => {
      res.status(200).json({stock: stock})
    })
    .catch(err => {
      sendError(err, res)
    })
});

router.post('/stock/:id/retire', (req, res) => {
  Stock.findById(req.params.id)
    .then(stock => {
      stock.active = false;
      return stock.save()
    })
    .then(stock => {
      return stock.populate('plate').execPopulate();
    })
    .then(stock => {
      res.status(200).json({active: stock.active})
    })
    .catch(err => {
      sendError(err, res)
    })
});
router.post('/stock/:id/activate', (req, res) => {
  Stock.findById(req.params.id)
    .then(stock => {
      stock.active = true;
      return stock.save()
    })
    .then(stock => {
      return stock.populate('plate').execPopulate();
    })
    .then(stock => {
      res.status(200).json({active: stock.active})
    })
    .catch(err => {
      sendError(err, res)
    })
});
router.post('/stock/:id/delete', (req, res) => {
  Stock.findById(req.params.id)
    .then(stock => {
      stock.deleted = true;
      return stock.save()
    })
    .then(stock => {
      return stock.populate('plate').execPopulate();
    })
    .then(stock => {
      res.status(200).json({active: stock.active})
    })
    .catch(err => {
      sendError(err, res)
    })
});
router.post('/stock/check/name', (req, res) => {
  const name = req.body.name;

  Stock.find({name})
    .then(stocks => {
      if (stocks && stocks.length) {
        res.send({ok: false});
      } else {
        res.send({ok: true})
      }

    })
    .catch(err => {
      sendError(err, res)
    })
});

function getAllPlates() {
  return Promise.all([
    Master.find({deleted: false}).populate('plates'),
    Stock.find({deleted: false}).populate('plate'),
  ])
    .then(two => {
      return new Promise((good, bad) => {

        const plates = [];
        two.map(one => {
          one.map(mors => {

            if (mors.plates) {
              mors.plates.map(plate => {
                plate.type = 'master';
                plates.push(plate);
              })
            }
            if (mors.plate) {
              mors.plate.type = 'stock';
              plates.push(mors.plate)
            }

          });
        });

        good(plates);

      })
    })
}


router.post('/stock/check/frs', (req, res) => {

  const toCheck = req.body.frs;
  const inUse = [];

  if (toCheck) {
    getAllPlates()
      .then(plates => {
        plates.map(plate => {
          labels.map(l => {
            toCheck.map(tc => {
              if (tc && tc.fr && plate[l] && plate[l].fr) {
                if (tc.fr === plate[l].fr) {
                  inUse.push(tc);
                }
              }
            })
          })
        });
        res.send({frs: inUse})
      })
      .catch(err => {
        sendError(err, res)
      })
  } else {
    sendError(new Error('no frs sent'), res)
  }

});

router.post('/stock/new', (req, res) => {

  const stock = req.body.stock;

  new Plate(stock.plate)
    .save()
    .then(savedPlate => {
      return new Stock({
        barcode: stock.barcode,
        name: stock.name,
        optimisation: stock.optimisation,
        plate: savedPlate.id,
        species: stock.species,
        speciesDescription: stock.speciesDescription,
        type: stock.type,
      }).save()
    })
    .then(savedStock => {
      res.status(200).json({stock: savedStock});
    })
    .catch(err => {
      console.error('error', err);
      sendError(err, res)
    });

});

router.post('/stock/:id/save', (req, res) => {

  const editedStock = req.body.stock;


  if (editedStock) {

    Stock.findById(editedStock._id)
      .populate('plate')
      .then(dbStock => {
        Object.keys(editedStock.plate).forEach(function (key) {
          if (key) {
            if (dbStock.plate[key] && editedStock.plate[key]) {
              if (key.indexOf('_') !== 0) {
                dbStock.plate[key] = editedStock.plate[key];
              }
            }
          }
        });

        dbStock.plate
          .save()
          .then(savedPlate => {
            return dbStock.save()
          })
          .then(savedStock => {
            return res.status(200).json({stock: savedStock})
          })
          .catch(err => {
            sendError(err, res)
          })


      })
      .catch(err => {
        return res.status(500).json({error: err})
      })
  } else {
    sendError(new Error('stock not found; please try refreshing the web app?'), res)
  }

});

// MASTER
router.post('/master/new', (req, res) => {

  /* ******************************************************************************** **/

  // STRATEGY:
  // 1) PREAMBLE FOR CREATING MASTER
  // 2) UPDATE STOCK I USED
  // 3) CREATE MASTER

  /* ******************************************************************************** **/

  // 1) PREAMBLE FOR CREATING MASTER

  const stockPlateFromPost = req.body.plate;
  const stockPlateId = stockPlateFromPost.id.toObjectId();
  const volumePerNewMasterPlateWell = req.body.volume;
  const replicates = req.body.replicates || 3; // always 3
  const noOfPlates = req.body.noOfPlates;
  const name = req.body.masterName;
  const repsLayout = req.body.repsLayout || 'vertically';
  const masterLayout = parseInt(req.body.masterLayout);
  
  let stockPlateItems = [];
  stockPlateFromPost.items.forEach(item => stockPlateItems.push(item));

  const getInt = (frOrEcStr) => parseInt(frOrEcStr.substring(2));

  if (masterLayout === 0){

    stockPlateItems = stockPlateItems.sort((a, b) =>
      getInt(a.fr) - getInt(b.fr)
    )
    console.log('sorted by asc fr', stockPlateItems.map(i => i.fr));
  } else if (masterLayout === 1){
    stockPlateItems = stockPlateItems.sort((a, b) =>
      getInt(b.fr) - getInt(a.fr)
    )
    console.log('sorted by rev fr', stockPlateItems.map(i => i.fr));

  } else if (masterLayout === 2){
    stockPlateItems = stockPlateItems.sort((a, b) =>
      getInt(b.ec) - getInt(a.ec)
    )
    console.log('sorted by rev ec', stockPlateItems.map(i => i.ec));
    
  } else if (masterLayout === 3){
    // no sort, as masterLayout option is to keep click order
    // stockPlateItems = stockPlateItems;
  } else {
    console.error('error getting sorting strategy')
  }

  

  if (!stockPlateItems || stockPlateItems === {}){
    console.error('big error stockplate sorting')
  }

  const wellsForMasterPlate = calculateWellsForMasterPlate(stockPlateItems, repsLayout, volumePerNewMasterPlateWell)

  /* ******************************************************************************** **/

  // 2) UPDATE THE CHANGES TO STOCK PLATE

  let stockFromDB = null;
  Stock.find({plate: stockPlateId})
  .populate('plate')
  .then(foundStocks => {
    if (foundStocks && foundStocks.length) {      
      stockFromDB = foundStocks[0];

      const volToTake = volumePerNewMasterPlateWell * replicates * noOfPlates;
      console.log('volToTake', volToTake);
      
      const frsTaken = Object.keys(stockPlateItems).map(index => {
        return stockPlateItems[index].fr;
      });
      // console.log('frsTaken', frsTaken);  

      labels.forEach(label => {
        if (frsTaken.includes(stockFromDB.plate[label].fr)) {
          // console.log('removing vol from', stockFromDB.plate[label]);
          
          stockFromDB.plate[label].volume -= volToTake;
        }
      });

      // sendError('EXITING TOO EARLY BY CHOICE', res);

      return stockFromDB.plate.save();

    } else {
      sendError('Stock plate not found (try refreshing web app?)', res);
    }
  })
  .then(() => {
    return stockFromDB.save()
  })

  /* ******************************************************************************** **/

  // 3) CREATE MASTER

  .then((savedStock) => {

    const platePromises = [];
    for (let i = 0; i < noOfPlates; i++) {
      platePromises.push(new MasterPlate(wellsForMasterPlate).save())
    }
    Promise.all(platePromises)
      .then(savedMasterPlates => {
        
        const masterPlateIds = savedMasterPlates.map(sp => sp.id);

        return new Master({
          masterPlates: masterPlateIds,
          species: savedStock.species,
          name: name,
          volume: volumePerNewMasterPlateWell,
          stock: savedStock.id
        }).save()
      })
      .then(savedMaster => {

        res.status(200).json({
          master: {
            id: savedMaster._id, 
            _id: savedMaster._id
          }
        });

      })
      .catch(err => {
        console.error('error', err);
        sendError(err, res)
      })
    ;
  });
});

router.get('/master', (req, res) => {

  Master.find({deleted: false})
    .then(masters => {
      const sorted = masters.filter(m => !m.deleted).reduce((all, current) => {
        current.active ? all.mastersActive.push(current) : all.mastersRetired.push(current);
        return all;
      }, {mastersActive: [], mastersRetired: []});
      res.status(200).json(sorted)
    })
    .catch(err => {
      sendError(err, res)
    })

});

router.get('/master/:id', (req, res) => {
  //console.log('REACHEY JACK JACK');
  
  Master.findById(req.params.id)
    .populate('masterPlates')
    .then(master => {
      res.status(200).json({master: master})
    })
    .catch(err => {
      sendError(err, res)
    })
});

router.post('/master/:id/retire', (req, res) => {
  Master.findById(req.params.id)
    .then(master => {
      master.active = false;
      return master.save()
    })
    .then(master => {
      return master.populate('plates').execPopulate();
    })
    .then(master => {
      res.status(200).json({active: master.active})
    })
    .catch(err => {
      sendError(err, res)
    })
});
router.post('/master/:id/activate', (req, res) => {
  Master.findById(req.params.id)
    .then(master => {
      master.active = true;
      return master.save()
    })
    .then(master => {
      return master.populate('plates').execPopulate();
    })
    .then(master => {
      res.status(200).json({active: master.active})
    })
    .catch(err => {
      sendError(err, res)
    })
});


router.post('/master/:id/delete', (req, res) => {
  Master.findById(req.params.id)
    .then(master => {
      master.deleted = true;
      return master.save()
    })
    .then(master => {
      return master.populate('plates').execPopulate();
    })
    .then(master => {
      res.status(200).json({active: master.active})
    })
    .catch(err => {
      sendError(err, res)
    })
});


//FREC
router.get('/frec', (req, res) => {

  const ecs = [];


  getAllPlates()
    .then(plates => {
      //get ecs
      plates.map(plate => {
        labels.map(l => {

          let ec = plate[l].ec;
          let fr = plate[l].fr;
          let volume = plate[l].volume;
          let plateID = plate._id;


          if (ec) {


            let filtered = ecs.filter(e => e.ec === ec);

            if (filtered.length) {
              //merge from same plate


              let frsFiltered = filtered[0].frs.filter(f => f.plateID === plateID);
              if (frsFiltered.length) {
                frsFiltered[0].volume += volume;
              } else {
                filtered[0].volume += volume;
                filtered[0].frs.push({fr, volume, plateID})
              }

            } else {
              ecs.push({ec, volume: volume, frs: [{fr, volume, plateID}]});
            }


          }
        })
      });

      res.status(200).json({ecs: ecs})

    })
    .catch(err => {
      sendError(err, res)
    })

});

router.post('/frec/search', (req, res) => {


  const lookingFor = req.body.id;
  const results = [];

  // Promise.all([
  //   Master.find({deleted: false}).populate('plates'),
  //   Stock.find({deleted: false}).populate('plate'),
  // ])
  //   .then(mastersAndStocks => {
  //
  //     const plates = [];
  //     mastersAndStocks.map(morsGroup => {
  //       morsGroup.map(mors => {
  //
  //         if (mors.plates) {
  //           mors.plates.map(plate => {
  //             plate.type = 'master';
  //             plates.push(plate);
  //           })
  //         }
  //         if (mors.plate) {
  //           mors.plate.type = 'stock';
  //           plates.push(mors.plate)
  //         }
  //
  //       });
  //     });

  getAllPlates().then(plates => {

    plates.map(plate => {
      labels.map(l => {

        let ec = plate[l].ec;
        let fr = plate[l].fr;
        let volume = plate[l].volume;
        let plateID = plate._id;


        if (lookingFor.length && lookingFor.length > 2) {
          if (ec && lookingFor) {

            if (ec.toUpperCase().indexOf(lookingFor.toUpperCase()) > -1) {

              if (!results.filter(r => {
                return r.ec === ec && r.fr === fr && r.volume === volume && r.plateID === plateID
              }).length)

                results.push({ec, fr, volume, plateID})
            }
          }
        }
      })
    });
    res.status(200).json({results: results})
  })
    .catch(err => {
      sendError(err, res);
    })
});


//PLATE

router.get('/plate/:id', (req, res) => {

  let stock = null;
  let master = null;

  const plateId = req.params.id.toObjectId();

  Stock.find({plate: plateId})
    .then(stocks => {
      if (stocks && stocks.length) {
        stock = stocks[0];
      }
      return Master.find({plate: plateId})
    })
    .then(masters => {
      if (masters.length) {
        master = masters[0]
      }
      res.status(200).json({stock, master})
    })
    .catch(err => {
      sendError(err, res);
    })

});


router.post('/plate/:id/take', (req, res) => {

  const volume = req.body.volume | 0;
  Plate.findById(req.params.id)
    .then(plate => {

      labels.map(l => {
        let well = plate[l];
        if (well) {
          well.volume -= volume;
        }
      });

      return plate.save()


    })
    .then(savedPlate => {
      res.status(200).json({plate: savedPlate})
    })
    .catch(err => {
      sendError(err, res);
    })

});

// MASTER PLATE

router.get('/masterPlate/:id', (req, res) => {

  let master = null;

  const masterPlateId = req.params.id.toObjectId();

  Master.find({masterPlate: masterPlateId})
    .then(masters => {
      if (masters && masters.length) {
        master = masters[0];
      }
      res.status(200).json({master})
    })
    .catch(err => {
      sendError(err, res);
    })

});

router.post('/masterPlate/:id/take', (req, res) => {

  const volume = req.body.volume | 0;
  MasterPlate.findById(req.params.id)
    .then(masterPlate => {

      labels.map(l => {
        let well = masterPlate[l];
        if (
          well &&
          well.upper && 
          well.upper.volume    
        ) {
          well.upper.volume -= volume;
          well.lower.volume -= volume;
        }
      });

      return masterPlate.save()

    })
    .then(savedMasterPlate => {
      res.status(200).json({masterPlate: savedMasterPlate})
    })
    .catch(err => {
      sendError(err, res);
    })

});

//AUTH

router.get('/user', (req, res) => {

  const authorizationHeader = req.headers.authorization;

  if (authorizationHeader && authorizationHeader.split(' ')[0] === 'Bearer') {
    jwt.verify(authorizationHeader.split(' ')[1], JWT_SECRET, function (err, decoded) {

      if (err) {
        res.status(500).json({error: err})
      } else {
        res.status(200).json({user: decoded})
      }

    });

  } else {
    res.status(500).json({error: 'No Bearer header'})
  }
});


// Add POST - /api/login
router.post('/login', (req, res) => {
  if (req.body && req.body.username && req.body.password) {

    ldap.authenticate(req.body.username, req.body.password)
      .then(user => {
        sign({username: user.username, name: user.displayName})
          .then(token => {
            res.status(200).json({token: token})
          })
          .catch(err => {
            res.status(500).json({error: err})
          })
      })
      .catch(err => {
        res.status(401).json({message: 'Bad credentials'})
      });
  } else {
    res.status(401).json({message: 'Incomplete credentials'})
  }
});

router.get('/logout', (req, res) => {
  res.sendStatus(200)
});
router.post('/logout', (req, res) => {
  res.sendStatus(200)
});

// Export the server middleware
export default {
  path: '/api',
  handler: router
}
