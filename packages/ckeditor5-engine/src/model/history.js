/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module engine/model/history
 */

import CKEditorError from 'ckeditor5-utils/src/ckeditorerror';

/**
 * `History` keeps the track of all the deltas applied to the {@link module:engine/model/document~Document document}. Deltas stored in
 * `History` might get updated, split into more deltas or even removed. This is used mostly to compress history, instead
 * of keeping all deltas in a state in which they were applied.
 *
 * **Note:** deltas kept in `History` should be used only to transform deltas. It's not advised to use `History` to get
 * original delta basing on it's {@link module:engine/model/delta/delta~Delta#baseVersion baseVersion}. Also, after transforming a
 * delta by deltas from `History`,
 * fix it's base version accordingly (set it to {@link module:engine/model/document~Document#version document version}).
 */
export default class History {
	/**
	 * Creates an empty History instance.
	 */
	constructor() {
		/**
		 * Deltas added to the history.
		 *
		 * @protected
		 * @member {Array.<module:engine/model/delta/delta~Delta>} module:engine/model/history~History#_deltas
		 */
		this._deltas = [];

		/**
		 * Helper structure that maps added delta's base version to the index in {@link module:engine/model/history~History#_deltas}
		 * at which the delta was added.
		 *
		 * @protected
		 * @member {Map} module:engine/model/history~History#_historyPoints
		 */
		this._historyPoints = new Map();
	}

	/**
	 * Adds delta to the history.
	 *
	 * @param {module:engine/model/delta/delta~Delta} delta Delta to add.
	 */
	addDelta( delta ) {
		if ( delta.operations.length > 0 && !this._historyPoints.has( delta.baseVersion ) ) {
			const index = this._deltas.length;

			this._deltas[ index ] = delta;
			this._historyPoints.set( delta.baseVersion, index );
		}
	}

	/**
	 * Returns deltas added to the history.
	 *
	 * @param {Number} [from=0] Base version from which deltas should be returned (inclusive). Defaults to `0`, which means
	 * that deltas from the first one will be returned.
	 * @param {Number} [to=Number.POSITIVE_INFINITY] Base version up to which deltas should be returned (exclusive).
	 * Defaults to `Number.POSITIVE_INFINITY` which means that deltas up to the last one will be returned.
	 * @returns {Iterator.<module:engine/model/delta/delta~Delta>} Deltas added to the history.
	 */
	*getDeltas( from = 0, to = Number.POSITIVE_INFINITY ) {
		// No deltas added, nothing to yield.
		if ( this._deltas.length === 0 ) {
			return;
		}

		// Will throw if base version is incorrect.
		let fromIndex = this._getIndex( from );

		// Base version is too low or too high and is not found in history.
		if ( fromIndex == -1 ) {
			return;
		}

		// We have correct `fromIndex` so let's iterate starting from it.
		while ( fromIndex < this._deltas.length ) {
			const delta = this._deltas[ fromIndex++ ];

			if ( delta.baseVersion >= to ) {
				break;
			}

			yield delta;
		}
	}

	/**
	 * Returns one or more deltas from history that bases on given `baseVersion`. Most often it will be just
	 * one delta, but if that delta got updated by multiple deltas, all of those updated deltas will be returned.
	 *
	 * @see module:engine/model/history~History#updateDelta
	 * @param {Number} baseVersion Base version of the delta to retrieve.
	 * @returns {Array.<module:engine/model/delta/delta~Delta>|null} Delta with given base version or null if no such delta is in history.
	 */
	getDelta( baseVersion ) {
		let index = this._historyPoints.get( baseVersion );

		if ( index === undefined ) {
			return null;
		}

		const deltas = [];

		for ( index; index < this._deltas.length; index++ ) {
			const delta = this._deltas[ index ];

			if ( delta.baseVersion != baseVersion ) {
				break;
			}

			deltas.push( delta );
		}

		return deltas.length === 0 ? null : deltas;
	}

	/**
	 * Removes delta from the history. This happens i.e., when a delta is undone by another delta. Both undone delta and
	 * undoing delta should be removed so they won't have an impact on transforming other deltas.
	 *
	 * **Note:** using this method does not change the state of {@link module:engine/model/document~Document model}. It just affects
	 * the state of `History`.
	 *
	 * **Note:** when some deltas are removed, deltas between them should probably get updated. See
	 * {@link module:engine/model/history~History#updateDelta}.
	 *
	 * **Note:** if delta with `baseVersion` got {@link module:engine/model/history~History#updateDelta updated} by multiple
	 * deltas, all updated deltas will be removed.
	 *
	 * @param {Number} baseVersion Base version of a delta to be removed.
	 */
	removeDelta( baseVersion ) {
		this.updateDelta( baseVersion, [] );
	}

	/**
	 * Substitutes delta in history by one or more given deltas.
	 *
	 * **Note:** if delta with `baseVersion` was already updated by multiple deltas, all updated deltas will be removed
	 * and new deltas will be inserted at their position.
	 *
	 * **Note:** removed delta won't get updated.
	 *
	 * @param {Number} baseVersion Base version of a delta to update.
	 * @param {Iterable.<module:engine/model/delta/delta~Delta>} updatedDeltas Deltas to be inserted in place of updated delta.
	 */
	updateDelta( baseVersion, updatedDeltas ) {
		const deltas = this.getDelta( baseVersion );

		// If there are no deltas, stop executing function as there is nothing to update.
		if ( deltas === null ) {
			return;
		}

		// Make sure that every updated delta has correct `baseVersion`.
		// This is crucial for algorithms in `History` and algorithms using `History`.
		for ( let delta of updatedDeltas ) {
			delta.baseVersion = baseVersion;
		}

		// Put updated deltas in place of old deltas.
		this._deltas.splice( this._getIndex( baseVersion ), deltas.length, ...updatedDeltas );

		// Update history points.
		const changeBy = updatedDeltas.length - deltas.length;

		for ( let key of this._historyPoints.keys() ) {
			if ( key > baseVersion ) {
				this._historyPoints.set( key, this._historyPoints.get( key ) + changeBy );
			}
		}
	}

	/**
	 * Gets an index in {@link module:engine/model/history~History#_deltas} where delta with given `baseVersion` is added.
	 *
	 * @private
	 * @param {Number} baseVersion Base version of delta.
	 */
	_getIndex( baseVersion ) {
		let index = this._historyPoints.get( baseVersion );

		// Base version not found - it is either too high or too low, or is in the middle of delta.
		if ( index === undefined ) {
			const lastDelta = this._deltas[ this._deltas.length - 1 ];
			const nextBaseVersion = lastDelta.baseVersion + lastDelta.operations.length;

			if ( baseVersion < 0 || baseVersion >= nextBaseVersion ) {
				// Base version is too high or too low - it's acceptable situation.
				// Return -1 because `baseVersion` was correct.
				return -1;
			}

			/**
			 * Given base version points to the middle of a delta.
			 *
			 * @error history-wrong-version
			 */
			throw new CKEditorError( 'model-history-wrong-version: Given base version points to the middle of a delta.' );
		}

		return index;
	}
}
